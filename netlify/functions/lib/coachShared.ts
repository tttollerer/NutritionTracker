import {
  API_ERROR_STATUS,
  COACH_SENTINEL,
  CoachChallengeRuleSchema,
  CoachChallengeSuggestionSchema,
  CoachGoalSuggestionSchema,
  CoachLogSuggestionSchema,
  CoachRequestSchema,
  CoachSuggestionsSchema,
  apiError,
  type ApiError,
  type ApiErrorCode,
  type CoachChallengeRule,
  type CoachRequest,
  type CoachSuggestions,
} from '../../../src/lib/apiContract'

/**
 * Pure Helfer der Coach-Function (netlify/functions/coach.mts) — hierher
 * ausgelagert, damit sie mit Vitest testbar sind (API_CONTRACT.md §1/§3,
 * ABSCHLUSSPLAN Paket 2). Kein Netlify-/ENV-Zugriff in dieser Datei.
 */

// ---------------------------------------------------------------------------
// Fehler-Envelope (API_CONTRACT.md §1)
// ---------------------------------------------------------------------------

/** Deutsche Fallback-Texte je Code — NIE Upstream-Rohtexte (Vertrag §1). */
export const COACH_ERROR_TEXT: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: 'Ungültige Anfrage.',
  BUDGET_EXCEEDED: 'Das Tageskontingent für KI-Anfragen ist aufgebraucht. Bitte versuch es morgen wieder.',
  PAYLOAD_TOO_LARGE: 'Die Anfrage ist zu groß. Bitte verkleinere das Foto.',
  RATE_LIMITED: 'Zu viele Anfragen. Bitte warte einen Moment und versuch es erneut.',
  UPSTREAM_ERROR: 'Der Coach ist gerade nicht erreichbar. Bitte versuch es später erneut.',
  UPSTREAM_TIMEOUT: 'Der Coach hat zu lange nicht geantwortet. Bitte versuch es später erneut.',
}

/** Envelope mit deutschem Fallback-Text zum Code bauen. */
export function coachError(code: ApiErrorCode): ApiError {
  return apiError(code, COACH_ERROR_TEXT[code])
}

/**
 * HTTP-Fehlerantwort als Envelope. Status default = kanonisches Mapping aus
 * API_ERROR_STATUS; `status` überschreibt für die Sonderfälle 405 (Method not
 * allowed → INVALID_REQUEST) und 500 (fehlende Server-Konfiguration →
 * UPSTREAM_ERROR), siehe Vertrag §1 Fußnoten.
 */
export function errorResponse(code: ApiErrorCode, status?: number): Response {
  return new Response(JSON.stringify(coachError(code)), {
    status: status ?? API_ERROR_STATUS[code],
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Request-Validierung (CoachRequestSchema v1.1: memory/context nullish)
// ---------------------------------------------------------------------------

export type ParsedCoachRequest =
  | { ok: true; data: CoachRequest }
  | { ok: false; error: ApiError }

/** Roh-Body gegen den Vertrag prüfen; Fehlerdetails bleiben serverseitig. */
export function parseCoachRequest(raw: string): ParsedCoachRequest {
  try {
    return { ok: true, data: CoachRequestSchema.parse(JSON.parse(raw)) }
  } catch {
    return { ok: false, error: coachError('INVALID_REQUEST') }
  }
}

// ---------------------------------------------------------------------------
// Upstream-Messages inkl. optionalem Foto-Feedback (Vertrag §3, v1.1)
// ---------------------------------------------------------------------------

export type UpstreamContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

/**
 * Chat-Verlauf in OpenRouter-Messages umbauen. Ist `imageBase64` gesetzt,
 * wird das Bild der LETZTEN User-Nachricht als Bild-Content beigelegt
 * (gleiches Format wie analyze.mts: Data-URL, JPEG angenommen).
 */
export function buildUpstreamMessages(
  parsed: CoachRequest,
  system: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: UpstreamContent }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: UpstreamContent }> = [
    { role: 'system', content: system },
  ]
  const lastUserIdx = parsed.messages.map((m) => m.role).lastIndexOf('user')
  parsed.messages.forEach((m, i) => {
    if (parsed.imageBase64 && i === lastUserIdx) {
      const dataUrl = parsed.imageBase64.startsWith('data:')
        ? parsed.imageBase64
        : `data:image/jpeg;base64,${parsed.imageBase64}`
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// Serverseitige Suggestions-Validierung (Vertrag §3, v1.1)
// ---------------------------------------------------------------------------

/** Kurzer, sicherer Log-Auszug eines verworfenen Eintrags (nie Rohtext-Fluten). */
function preview(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 120) ?? String(value)
  } catch {
    return '<nicht serialisierbar>'
  }
}

/**
 * v1.2 (Befund 4 + 8): Vorschläge EINZELN retten statt die ganze Zeile zu
 * verwerfen.
 * - Ziel mit nicht erlaubtem/ungültigem nutrient → Ziel verworfen (onWarn),
 *   damit es beim Nutzer nicht als "Übernommen ins Nichts" endet.
 * - Challenge mit kaputter rule → rule entfernt, Challenge bleibt (manuell
 *   abschließbar); rule.days wird bei period 'day' still gestrippt.
 * - Kaputter Log-Vorschlag → Eintrag verworfen (onWarn).
 * Liefert null, wenn nach dem Aufräumen nichts Übernehmbares übrig ist.
 */
export function sanitizeSuggestions(
  parsed: unknown,
  onWarn: (msg: string) => void = () => {},
): CoachSuggestions | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const src = parsed as Record<string, unknown>
  const out: CoachSuggestions = {}

  if (Array.isArray(src.goals)) {
    const goals = []
    for (const g of src.goals) {
      const r = CoachGoalSuggestionSchema.safeParse(g)
      if (r.success) goals.push(r.data)
      else onWarn(`coach: Ziel-Vorschlag verworfen (nutrient nicht erlaubt/ungültig): ${preview(g)}`)
    }
    if (goals.length) out.goals = goals
  }

  if (Array.isArray(src.challenges)) {
    const challenges = []
    for (const c of src.challenges) {
      if (!c || typeof c !== 'object') {
        onWarn(`coach: Challenge-Vorschlag verworfen (kein Objekt): ${preview(c)}`)
        continue
      }
      const { rule, ...base } = c as Record<string, unknown>
      const baseParsed = CoachChallengeSuggestionSchema.safeParse(base)
      if (!baseParsed.success) {
        onWarn(`coach: Challenge-Vorschlag verworfen (title/period ungültig): ${preview(c)}`)
        continue
      }
      let cleanRule: CoachChallengeRule | undefined
      if (rule !== undefined) {
        // days ist nur bei period 'week' sinnvoll — bei 'day' still strippen,
        // statt eine sonst gültige rule zu opfern.
        const candidate =
          baseParsed.data.period !== 'week' && rule && typeof rule === 'object'
            ? (() => {
                const rest = { ...(rule as Record<string, unknown>) }
                delete rest.days
                return rest
              })()
            : rule
        const ruleParsed = CoachChallengeRuleSchema.safeParse(candidate)
        if (ruleParsed.success) cleanRule = ruleParsed.data
        else onWarn(`coach: kaputte Challenge-rule entfernt (Challenge bleibt manuell): ${preview(rule)}`)
      }
      challenges.push(cleanRule ? { ...baseParsed.data, rule: cleanRule } : baseParsed.data)
    }
    if (challenges.length) out.challenges = challenges
  }

  if (Array.isArray(src.logs)) {
    const logs = []
    for (const l of src.logs) {
      const r = CoachLogSuggestionSchema.safeParse(l)
      if (r.success) logs.push(r.data)
      else onWarn(`coach: Log-Vorschlag verworfen (ungültig): ${preview(l)}`)
    }
    if (logs.length) out.logs = logs
  }

  if (!out.goals?.length && !out.challenges?.length && !out.logs?.length) return null
  // Abschluss-Gate: das Ergebnis MUSS den Vertrag erfüllen (Defense in Depth).
  const final = CoachSuggestionsSchema.safeParse(out)
  return final.success ? final.data : null
}

/**
 * Suggestions-Rohtext (alles nach dem Sentinel) validieren. Liefert die
 * normalisierte JSON-Zeile oder null, wenn sie verworfen werden muss —
 * kaputtes JSON erreicht den Client nie. v1.2: einzelne ungültige Einträge
 * werden über sanitizeSuggestions gerettet/verworfen (onWarn loggt).
 */
export function validateSuggestionsLine(
  raw: string,
  onWarn: (msg: string) => void = () => {},
): string | null {
  const line = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
  if (!line) return null
  try {
    const clean = sanitizeSuggestions(JSON.parse(line), onWarn)
    return clean == null ? null : JSON.stringify(clean)
  } catch {
    return null
  }
}

/** Längster Suffix des Texts, der ein Präfix des Sentinels ist (Chunk-Grenzen). */
function sentinelHoldback(text: string): number {
  const max = Math.min(text.length, COACH_SENTINEL.length - 1)
  for (let n = max; n > 0; n--) {
    if (text.endsWith(COACH_SENTINEL.slice(0, n))) return n
  }
  return 0
}

export interface SuggestionsFilter {
  /** Token-Chunk einspeisen; liefert den Text, der sofort gestreamt werden darf. */
  push(chunk: string): string
  /**
   * Stream-Ende: liefert restlichen Text — inkl. Sentinel + validierter
   * Suggestions-Zeile, sofern gültig. `dropped` = eine vorhandene, aber
   * ungültige Suggestions-Zeile wurde verworfen (Aufrufer loggt).
   */
  finish(): { text: string; dropped: boolean }
}

/**
 * Streaming-Filter: Text vor dem Sentinel fließt live durch, alles ab dem
 * Sentinel wird gepuffert und erst nach Validierung (oder gar nicht)
 * weitergegeben. Erkennt den Sentinel auch über Chunk-Grenzen hinweg.
 * `onWarn` (v1.2) bekommt je einzeln verworfenem Vorschlag eine Log-Zeile.
 */
export function createSuggestionsFilter(onWarn?: (msg: string) => void): SuggestionsFilter {
  let held = ''
  let afterSentinel = false
  let suggestions = ''
  return {
    push(chunk: string): string {
      if (afterSentinel) {
        suggestions += chunk
        return ''
      }
      held += chunk
      const idx = held.indexOf(COACH_SENTINEL)
      if (idx >= 0) {
        afterSentinel = true
        suggestions = held.slice(idx + COACH_SENTINEL.length)
        const out = held.slice(0, idx)
        held = ''
        return out
      }
      const hold = sentinelHoldback(held)
      const out = held.slice(0, held.length - hold)
      held = held.slice(held.length - hold)
      return out
    },
    finish(): { text: string; dropped: boolean } {
      if (!afterSentinel) {
        const text = held
        held = ''
        return { text, dropped: false }
      }
      const valid = validateSuggestionsLine(suggestions, onWarn)
      if (valid == null) return { text: '', dropped: suggestions.trim().length > 0 }
      return { text: `${COACH_SENTINEL}\n${valid}`, dropped: false }
    },
  }
}

// ---------------------------------------------------------------------------
// Timeout-Erkennung (AbortSignal.timeout → UPSTREAM_TIMEOUT)
// ---------------------------------------------------------------------------

/** True für AbortSignal.timeout-/AbortController-Abbrüche des Upstream-Fetch. */
export function isAbortError(e: unknown): boolean {
  // Bewusst über `name` statt `instanceof Error`: DOMException (TimeoutError)
  // erbt nicht in jeder Runtime von Error.
  if (typeof e !== 'object' || e === null || !('name' in e)) return false
  const name = (e as { name?: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}
