import {
  AnalyzeItemSchema,
  AnalyzeResultSchema,
  type AnalyzeItem,
  type AnalyzeRequest,
  type AnalyzeResult,
} from './apiContract'
import { ApiError, apiErrorFromResponse, isOffline, toApiError } from './apiError'

/**
 * Vertrags-Schemata aus apiContract.ts (v1.1) unter den bisherigen Namen
 * re-exportiert — die EINE Quelle ist der Vertrag, nicht diese Datei.
 */
export const AiItem = AnalyzeItemSchema
export const AiResult = AnalyzeResultSchema
export type AiItem = AnalyzeItem
export type AiResult = AnalyzeResult
export type AnalyzeMode = AnalyzeRequest['mode']

const ENDPOINT = import.meta.env.VITE_ANALYZE_URL ?? '/api/analyze'
const TIMEOUT_MS = 30_000

/**
 * Ruft die KI-Analyse-Function auf und validiert die Antwort.
 * Fehler kommen IMMER als typisierter ApiError (Mapping über `code`,
 * Anzeige über `t(err.i18nKey)`), nie als roher fetch-/Parse-Fehler.
 *
 * `extraImages` sind weitere Fotos DESSELBEN Produkts (z. B. die
 * Nährwerttabelle nach dem Produktfoto im `label`-Modus) — optional.
 */
export async function analyzeImage(
  mode: AnalyzeMode,
  imageBase64: string,
  hint?: string,
  extraImages?: string[],
): Promise<AiResult> {
  if (isOffline()) throw new ApiError('OFFLINE')

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, imageBase64, images: extraImages?.length ? extraImages : undefined, hint }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    // Netzwerkfehler (TypeError) → OFFLINE, AbortSignal.timeout → TIMEOUT
    throw toApiError(e)
  }

  // Erst res.ok prüfen, dann parsen — Fehler tragen den Envelope aus dem Vertrag.
  if (!res.ok) throw await apiErrorFromResponse(res)

  try {
    return AnalyzeResultSchema.parse(await res.json())
  } catch {
    // 200 mit kaputtem Body (z. B. HTML einer Zwischenschicht) → kein Parse-Crash
    throw new ApiError('GENERIC')
  }
}
