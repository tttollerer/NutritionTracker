import { z } from 'zod'

/** Antwort-Schema der KI-Analyse (deckungsgleich mit der Netlify-Function). */
export const AiItem = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  unit: z.enum(['g', 'ml', 'portion']),
  confidence: z.number().min(0).max(1).optional(),
  per100: z.object({
    kcal: z.number().nonnegative(),
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
    micros: z.record(z.number().nonnegative()).optional(),
  }),
})
export const AiResult = z.object({ items: z.array(AiItem), notes: z.string().optional() })

export type AiItem = z.infer<typeof AiItem>
export type AiResult = z.infer<typeof AiResult>
export type AnalyzeMode = 'meal' | 'label' | 'portion'

const ENDPOINT = import.meta.env.VITE_ANALYZE_URL ?? '/api/analyze'

/** Ruft die KI-Analyse-Function auf und validiert die Antwort. */
export async function analyzeImage(
  mode: AnalyzeMode,
  imageBase64: string,
  hint?: string,
): Promise<AiResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, imageBase64, hint }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? `Analyse fehlgeschlagen (${res.status})`)
  return AiResult.parse(data)
}
