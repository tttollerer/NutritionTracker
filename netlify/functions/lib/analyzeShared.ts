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
