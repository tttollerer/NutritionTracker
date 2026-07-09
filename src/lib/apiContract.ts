import { z } from 'zod'

/**
 * API-Vertrag v1.2 zwischen Client (src/) und Netlify Functions
 * (netlify/functions/analyze.mts, coach.mts) — die EINE Quelle für
 * Fehler-Envelope, Fehlercodes und Request-/Response-Schemata.
 *
 * Doku: docs/API_CONTRACT.md. Umsetzung in den Functions: Arbeitspaket 2/3,
 * Umstellung des Clients (ai.ts/coach.ts importieren von hier): Paket 7.
 * Bis dahin definiert diese Datei den SOLL-Vertrag; bestehende Dateien
 * bleiben unverändert.
 *
 * v1.2 (Erwartungs-Audit Befund 4 + 8, nur additiv):
 * - Ziel-Vorschläge: `nutrient` ist ein Enum statt beliebiger String —
 *   nur Nährstoffe, die die App auch anzeigen/auswerten kann.
 * - Challenge-Vorschläge: optionales `rule`-Feld im Format von
 *   parseChallengeRule (src/lib/challenges.ts) für die Auto-Auswertung.
 */

export const API_CONTRACT_VERSION = '1.2'

// ---------------------------------------------------------------------------
// Fehler-Envelope (gilt für ALLE Nicht-200-Antworten beider Endpunkte)
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  'INVALID_REQUEST',
  'BUDGET_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
] as const

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES)
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

/**
 * Einheitlicher Fehler-Body. `error` ist ein deutscher Nutzertext-Fallback
 * (i18n-tauglich, KEIN Upstream-Rohtext, kein Stacktrace); der Client mappt
 * primär über `code` auf eigene i18n-Texte.
 */
export const ApiErrorSchema = z.object({
  error: z.string().min(1),
  code: ApiErrorCodeSchema,
})
export type ApiError = z.infer<typeof ApiErrorSchema>

/** Kanonischer HTTP-Status je Fehlercode. Clients entscheiden über `code`, nicht über den Status. */
export const API_ERROR_STATUS: Record<ApiErrorCode, 400 | 402 | 413 | 429 | 502 | 504> = {
  INVALID_REQUEST: 400,
  BUDGET_EXCEEDED: 402,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
}

/** Bequemer Konstruktor für Functions (Paket 2/3). */
export function apiError(code: ApiErrorCode, error: string): ApiError {
  return { code, error }
}

// ---------------------------------------------------------------------------
// /api/analyze — Bildanalyse (Modi meal | label | portion, PLAN.md §6)
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  mode: z.enum(['meal', 'label', 'portion']),
  /** Data-URL oder rohes Base64 (JPEG angenommen, wenn ohne Präfix). */
  imageBase64: z.string().min(1),
  hint: z.string().max(280).optional(),
})
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>

export const AnalyzeItemSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  unit: z.enum(['g', 'ml', 'portion']),
  confidence: z.number().min(0).max(1).optional(),
  per100: z.object({
    kcal: z.number().nonnegative(),
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
    /** Mikronährstoffe je 100 g/ml; Schlüssel = Katalog aus src/lib/nutrients.ts. */
    micros: z.record(z.number().nonnegative()).optional(),
  }),
})
export const AnalyzeResultSchema = z.object({
  items: z.array(AnalyzeItemSchema),
  notes: z.string().optional(),
})
export type AnalyzeItem = z.infer<typeof AnalyzeItemSchema>
export type AnalyzeResult = z.infer<typeof AnalyzeResultSchema>

// ---------------------------------------------------------------------------
// /api/coach — Coach-Chat mit Token-Streaming (PLAN.md §9.3)
// ---------------------------------------------------------------------------

export const CoachChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
})

/**
 * v1.1: `context` und `memory` sind NULLISH (null ODER weggelassen sind beide
 * gültig). Behebt die Drift „Client sendet memory:null (src/lib/coach.ts:164)
 * → Server-Schema z.record().optional() (netlify/functions/coach.mts:20)
 * → 400 INVALID_REQUEST für Nutzer ohne CoachMemory".
 *
 * `imageBase64` ist neu in v1.1 (Coach-Foto-Feedback, Umsetzung Paket 2).
 */
export const CoachRequestSchema = z.object({
  messages: z.array(CoachChatMessageSchema).min(1).max(40),
  context: z.record(z.unknown()).nullish(),
  memory: z.record(z.unknown()).nullish(),
  imageBase64: z.string().min(1).optional(),
})
export type CoachRequest = z.infer<typeof CoachRequestSchema>

/** Trenner zwischen gestreamtem Antworttext und der einzeiligen Vorschlags-JSON. */
export const COACH_SENTINEL = '###SUGGESTIONS###'

/**
 * v1.2 (Befund 4): Erlaubte Nährstoffe für Coach-Ziele UND Challenge-Regeln.
 * Nur was die App real anzeigen/auswerten kann:
 * - kcal/protein/carbs/fat → Makro-Ringe + Goal-/Challenge-Auswertung
 *   (src/lib/challenges.ts TRACKED, src/lib/gamification.ts goalMet).
 * - sugar/fiber/sodium → getrackte micros-Schlüssel aus dem Katalog
 *   (src/lib/nutrients.ts), angezeigt im NutrientPanel; sugar/sodium sind
 *   Limits mit limitOverrides-Mechanik (src/lib/deficit.ts:29).
 * BEWUSST NICHT enthalten: 'salt' — der Katalog trackt 'sodium' (mg), ein
 * "salt"-Ziel hätte keinen computed-Wert. Ebenso keine weiteren Mikros
 * (vitaminC, iron, …), solange die App dafür keine Zielanzeige hat.
 */
export const COACH_NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'fiber', 'sodium'] as const
export const CoachNutrientSchema = z.enum(COACH_NUTRIENTS)
export type CoachNutrient = z.infer<typeof CoachNutrientSchema>

/** Ziel-Vorschlag (v1.2: nutrient als Enum statt beliebigem String). */
export const CoachGoalSuggestionSchema = z.object({
  nutrient: CoachNutrientSchema,
  type: z.enum(['min', 'max', 'range']),
  target: z.number(),
  targetMax: z.number().optional(),
  unit: z.string(),
  reason: z.string().optional(),
})
export type CoachGoalSuggestion = z.infer<typeof CoachGoalSuggestionSchema>

/**
 * v1.2 (Befund 8): Auto-auswertbare Challenge-Regel — exakt das Format, das
 * parseChallengeRule (src/lib/challenges.ts:33) akzeptiert: nutrient aus dem
 * Enum, type min|max, target > 0, optional unit und (nur period 'week')
 * days 1–7 als geforderte Erfolgstage.
 */
export const CoachChallengeRuleSchema = z.object({
  nutrient: CoachNutrientSchema,
  type: z.enum(['min', 'max']),
  target: z.number().positive(),
  unit: z.string().optional(),
  days: z.number().int().min(1).max(7).optional(),
})
export type CoachChallengeRule = z.infer<typeof CoachChallengeRuleSchema>

/**
 * Challenge-Vorschlag. `rule` ist optional (v1.1-Form { title, period } bleibt
 * gültig); ohne rule ist die Challenge manuell abschließbar statt automatisch
 * ausgewertet. `rule.days` ist nur bei period 'week' erlaubt.
 */
export const CoachChallengeSuggestionSchema = z
  .object({
    title: z.string(),
    period: z.enum(['day', 'week']),
    rule: CoachChallengeRuleSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.period !== 'week' && c.rule?.days != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rule.days ist nur bei period "week" erlaubt',
        path: ['rule', 'days'],
      })
    }
  })
export type CoachChallengeSuggestion = z.infer<typeof CoachChallengeSuggestionSchema>

/** Log-Vorschlag (unverändert seit v1.1). */
export const CoachLogSuggestionSchema = z.object({
  name: z.string(),
  amount: z.number(),
  unit: z.enum(['g', 'ml', 'portion']),
  per100: z.object({
    kcal: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})
export type CoachLogSuggestion = z.infer<typeof CoachLogSuggestionSchema>

/**
 * Vorschlags-Schema der Suggestions-Zeile. v1.1: wird SERVERSEITIG validiert
 * (Paket 2) — eine ungültige Zeile wird verworfen und erreicht den Client nie.
 * v1.2: Der Server verwirft zusätzlich EINZELNE ungültige Einträge (Ziel mit
 * nicht erlaubtem nutrient → Ziel weg, kaputte Challenge-rule → rule weg,
 * Challenge bleibt) statt die ganze Zeile zu opfern — siehe
 * sanitizeSuggestions in netlify/functions/lib/coachShared.ts.
 */
export const CoachSuggestionsSchema = z.object({
  goals: z.array(CoachGoalSuggestionSchema).optional(),
  challenges: z.array(CoachChallengeSuggestionSchema).optional(),
  logs: z.array(CoachLogSuggestionSchema).optional(),
})
export type CoachSuggestions = z.infer<typeof CoachSuggestionsSchema>

// ---------------------------------------------------------------------------
// Coach-Stream: Fehler-Event (v1.1)
// ---------------------------------------------------------------------------

/**
 * Bricht der Upstream MITTEN im 200er-Stream ab, sendet der Server statt des
 * bisherigen "\n[Fehler: …]"-Texts einen SSE-artigen Event-Block als eigene
 * Zeilen im Token-Stream:
 *
 *   event: error
 *   data: {"error":"…","code":"UPSTREAM_ERROR"}
 *
 * Der Client filtert den Block aus dem Antworttext und behandelt den Envelope
 * wie einen HTTP-Fehler. encode/extract sind die geteilte Referenz-Implementierung.
 */
export const COACH_STREAM_ERROR_EVENT = 'error'

export function encodeCoachStreamError(err: ApiError): string {
  return `\nevent: ${COACH_STREAM_ERROR_EVENT}\ndata: ${JSON.stringify(err)}\n\n`
}

const STREAM_ERROR_RE = /(?:^|\n)event: error\r?\ndata: (.*)(?:\r?\n|$)/

/** Fallback, falls die data-Zeile selbst kaputt ankommt (abgeschnittener Stream). */
const STREAM_ERROR_FALLBACK: ApiError = {
  code: 'UPSTREAM_ERROR',
  error: 'Der Coach ist gerade nicht erreichbar. Bitte versuch es später erneut.',
}

/**
 * Entfernt einen ggf. enthaltenen Fehler-Event-Block aus dem (Teil-)Streamtext
 * und liefert den geparsten Envelope. Kein Block → `error: null`.
 */
export function extractCoachStreamError(streamText: string): {
  text: string
  error: ApiError | null
} {
  const m = STREAM_ERROR_RE.exec(streamText)
  if (!m) return { text: streamText, error: null }
  let error: ApiError
  try {
    error = ApiErrorSchema.parse(JSON.parse(m[1]))
  } catch {
    error = STREAM_ERROR_FALLBACK
  }
  const text = streamText.slice(0, m.index) + streamText.slice(m.index + m[0].length)
  return { text, error }
}
