import {
  API_ERROR_STATUS,
  AnalyzeRequestSchema,
  apiError,
  type AnalyzeRequest,
  type ApiError,
  type ApiErrorCode,
} from '../../../src/lib/apiContract'

/**
 * Pure Helfer der Analyze-Function (netlify/functions/analyze.mts) — hierher
 * ausgelagert, damit sie mit Vitest testbar sind (API_CONTRACT.md §1/§2,
 * ABSCHLUSSPLAN Paket 3; Muster analog lib/coachShared.ts, Paket 2).
 * Kein Netlify-/ENV-Zugriff in dieser Datei.
 */

// ---------------------------------------------------------------------------
// Fehler-Envelope (API_CONTRACT.md §1) — analyze-spezifische Texte
// ---------------------------------------------------------------------------

/** Deutsche Fallback-Texte je Code — NIE Upstream-Rohtexte (Vertrag §1). */
export const ANALYZE_ERROR_TEXT: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: 'Ungültige Anfrage.',
  BUDGET_EXCEEDED: 'Das Tageskontingent für KI-Anfragen ist aufgebraucht. Bitte versuch es morgen wieder.',
  PAYLOAD_TOO_LARGE: 'Das Bild ist zu groß. Bitte verkleinere das Foto.',
  RATE_LIMITED: 'Zu viele Anfragen. Bitte warte einen Moment und versuch es erneut.',
  UPSTREAM_ERROR: 'Die Bildanalyse ist gerade nicht erreichbar. Bitte versuch es später erneut.',
  UPSTREAM_TIMEOUT: 'Die Bildanalyse hat zu lange gedauert. Bitte versuch es später erneut.',
}

/** Envelope mit deutschem Fallback-Text zum Code bauen. */
export function analyzeError(code: ApiErrorCode): ApiError {
  return apiError(code, ANALYZE_ERROR_TEXT[code])
}

/**
 * HTTP-Fehlerantwort als Envelope. Status default = kanonisches Mapping aus
 * API_ERROR_STATUS; `status` überschreibt für die Vertrags-Sonderfälle
 * 405 (Method not allowed → INVALID_REQUEST) und 500 (fehlende
 * Server-Konfiguration → UPSTREAM_ERROR), siehe Vertrag §1 Fußnoten.
 */
export function analyzeErrorResponse(code: ApiErrorCode, status?: number): Response {
  return new Response(JSON.stringify(analyzeError(code)), {
    status: status ?? API_ERROR_STATUS[code],
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Request-Validierung (AnalyzeRequestSchema aus dem Vertrag)
// ---------------------------------------------------------------------------

export type ParsedAnalyzeRequest =
  | { ok: true; data: AnalyzeRequest }
  | { ok: false; error: ApiError }

/** Roh-Body gegen den Vertrag prüfen; Fehlerdetails bleiben serverseitig. */
export function parseAnalyzeRequest(raw: string): ParsedAnalyzeRequest {
  try {
    return { ok: true, data: AnalyzeRequestSchema.parse(JSON.parse(raw)) }
  } catch {
    return { ok: false, error: analyzeError('INVALID_REQUEST') }
  }
}

// ---------------------------------------------------------------------------
// Modell-Antwort → JSON (mit Markdown-Zaun-Toleranz)
// ---------------------------------------------------------------------------

/**
 * JSON aus der Modellantwort ziehen — toleriert ```json-Zäune und Text um
 * das Objekt herum. Wirft bei dauerhaft kaputtem JSON (Aufrufer retryt einmal
 * und antwortet dann mit UPSTREAM_ERROR-Envelope, nie mit dem Rohtext).
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Antwort enthielt kein gültiges JSON')
  }
}

// ---------------------------------------------------------------------------
// questions-Feld (Vertrag v1.2, Paket B) — Sanitizing VOR der zod-Validierung
// ---------------------------------------------------------------------------

/** Max. Rückfragen laut Vertrag (AnalyzeResultSchema.questions). */
export const MAX_QUESTIONS = 2

/**
 * Kappt das `questions`-Feld einer rohen Modellantwort auf das Vertragsformat,
 * BEVOR AnalyzeResultSchema.parse läuft: nur nicht-leere Strings, gekürzt auf
 * 200 Zeichen, maximal MAX_QUESTIONS Einträge; leeres/fremdes Feld wird
 * entfernt. So kippt ein übermotiviertes Modell (3 Fragen, leere Strings)
 * nicht die ganze — sonst gültige — Antwort in den UPSTREAM_ERROR.
 */
export function clampQuestions(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = raw as Record<string, unknown>
  if (!('questions' in obj)) return raw
  const { questions, ...rest } = obj
  const cleaned = Array.isArray(questions)
    ? questions
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim().slice(0, 200))
        .slice(0, MAX_QUESTIONS)
    : []
  return cleaned.length ? { ...rest, questions: cleaned } : rest
}

// ---------------------------------------------------------------------------
// barcode-Feld (Vertrag v1.4) — Sanitizing VOR der zod-Validierung
// ---------------------------------------------------------------------------

/**
 * Normalisiert das `barcode`-Feld einer rohen Modellantwort: Modelle liefern
 * gern „4 012345 678901" oder Zahlen statt Strings. Ziffern extrahieren;
 * nur 8–14 Stellen sind ein plausibler EAN/UPC — sonst fliegt das Feld raus,
 * statt eine sonst gültige Antwort an der Validierung scheitern zu lassen.
 */
export function clampBarcode(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = raw as Record<string, unknown>
  if (!('barcode' in obj)) return raw
  const { barcode, ...rest } = obj
  const digits =
    typeof barcode === 'string' || typeof barcode === 'number'
      ? String(barcode).replace(/\D/g, '')
      : ''
  return digits.length >= 8 && digits.length <= 14 ? { ...rest, barcode: digits } : rest
}

// ---------------------------------------------------------------------------
// Kassenbon-Antwort (Vertrag v1.3) — Sanitizing VOR der zod-Validierung
// ---------------------------------------------------------------------------

/** Obergrenze je Position — schützt vor Fehl-Lesungen (z. B. EAN-Ziffern als Stückzahl). */
export const MAX_RECEIPT_QUANTITY = 99

/** Endliche Zahl ≥ 0? (Makros/Preis dürfen nie negativ oder NaN sein) */
function nonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/**
 * Normalisiert eine rohe Kassenbon-Modellantwort auf das Vertragsformat,
 * BEVOR ReceiptResultSchema.parse läuft — Bons sind schmutzige Inputs und
 * Modelle liefern gern krumme Stückzahlen („2.0"), negative Pfand-Preise oder
 * halb gefüllte per100-Objekte. Regeln:
 * - Positionen ohne brauchbaren Namen fliegen raus (statt die Antwort zu kippen).
 * - quantity: auf ganze Stück gerundet, geklemmt auf 1..MAX_RECEIPT_QUANTITY
 *   (fehlend/kaputt → 1).
 * - price: nur endliche Werte ≥ 0, auf Cent gerundet; sonst weggelassen.
 * - per100: nur übernommen, wenn ALLE vier Makros endliche Werte ≥ 0 sind.
 * Fehlt `items` ganz, bleibt die Antwort unverändert (zod → Retry/Envelope).
 */
export function clampReceipt(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const items = (raw as Record<string, unknown>).items
  if (!Array.isArray(items)) return raw
  const cleaned = items.flatMap((it) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return []
    const o = it as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) return []
    const rawQty = typeof o.quantity === 'number' && Number.isFinite(o.quantity) ? Math.round(o.quantity) : 1
    const quantity = Math.min(MAX_RECEIPT_QUANTITY, Math.max(1, rawQty))
    const price = nonNegative(o.price) ? Math.round(o.price * 100) / 100 : undefined
    let per100: { kcal: number; protein: number; carbs: number; fat: number } | undefined
    const p = o.per100
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const m = p as Record<string, unknown>
      if (nonNegative(m.kcal) && nonNegative(m.protein) && nonNegative(m.carbs) && nonNegative(m.fat)) {
        per100 = { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat }
      }
    }
    return [{ name, quantity, ...(price != null ? { price } : {}), ...(per100 ? { per100 } : {}) }]
  })
  return { items: cleaned }
}
