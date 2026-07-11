import {
  AnalyzeItemSchema,
  AnalyzeResultSchema,
  AutoAnalyzeResultSchema,
  ReceiptResultSchema,
  type AnalyzeItem,
  type AnalyzeRequest,
  type AnalyzeResult,
  type AutoAnalyzeResult,
  type ReceiptItem,
  type ReceiptResult,
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
export type { AutoAnalyzeResult, ReceiptItem, ReceiptResult }

const ENDPOINT = import.meta.env.VITE_ANALYZE_URL ?? '/api/analyze'
const TIMEOUT_MS = 30_000

/**
 * Gemeinsamer POST an die Analyse-Function. Fehler kommen IMMER als
 * typisierter ApiError (Mapping über `code`, Anzeige über `t(err.i18nKey)`),
 * nie als roher fetch-/Parse-Fehler.
 */
async function postAnalyze(body: AnalyzeRequest): Promise<unknown> {
  if (isOffline()) throw new ApiError('OFFLINE')

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    // Netzwerkfehler (TypeError) → OFFLINE, AbortSignal.timeout → TIMEOUT
    throw toApiError(e)
  }

  // Erst res.ok prüfen, dann parsen — Fehler tragen den Envelope aus dem Vertrag.
  if (!res.ok) throw await apiErrorFromResponse(res)

  try {
    return await res.json()
  } catch {
    // 200 mit kaputtem Body (z. B. HTML einer Zwischenschicht) → kein Parse-Crash
    throw new ApiError('GENERIC')
  }
}

/** Bildanalyse (meal | label | portion) — Antwort validiert gegen den Vertrag. */
export async function analyzeImage(
  mode: AnalyzeMode,
  imageBase64: string,
  hint?: string,
): Promise<AiResult> {
  const json = await postAnalyze({ mode, imageBase64, hint })
  try {
    return AnalyzeResultSchema.parse(json)
  } catch {
    throw new ApiError('GENERIC')
  }
}

/** Kassenbon-Scan (Vertrag v1.3): eigenes Antwortschema — Bon-Positionen. */
export async function analyzeReceipt(imageBase64: string, hint?: string): Promise<ReceiptResult> {
  const json = await postAnalyze({ mode: 'receipt', imageBase64, hint })
  try {
    return ReceiptResultSchema.parse(json)
  } catch {
    throw new ApiError('GENERIC')
  }
}

/**
 * Unified Scan (Vertrag v1.6, mode 'auto'): das Modell klassifiziert das Bild
 * selbst (Gericht | Verpackung | Strichcode | Kassenbon) und liefert das
 * bekannte Modus-Ergebnis plus Pflichtfeld `kind` — der Client routet damit
 * (src/lib/scanRoute.ts).
 */
export async function analyzeAuto(imageBase64: string, hint?: string): Promise<AutoAnalyzeResult> {
  const json = await postAnalyze({ mode: 'auto', imageBase64, hint })
  try {
    return AutoAnalyzeResultSchema.parse(json)
  } catch {
    throw new ApiError('GENERIC')
  }
}

/**
 * Nährwerte NUR aus dem Produktnamen schätzen (Vertrag v1.5, mode 'estimate') —
 * der einzige Modus ohne Bild; es wird also auch kein Foto übertragen
 * (photoConsent nicht nötig). Fürs Manuell-Anlegen im Produkt-Sheet.
 */
export async function estimateNutrients(name: string): Promise<AiResult> {
  const json = await postAnalyze({ mode: 'estimate', hint: name.trim().slice(0, 280) })
  try {
    return AnalyzeResultSchema.parse(json)
  } catch {
    throw new ApiError('GENERIC')
  }
}
