import type { FoodItem, LogEntry } from '@/db/types'
import type { AnalyzeResult } from './apiContract'

/**
 * Anzeige-Text einer gemerkten üblichen Portion: mit Label „1 Tasse (80 g)",
 * ohne Label schlicht „80 g". Pure Funktion — direkt testbar. `portionWord`
 * kommt aus i18n (t('today.edit.unitPortion')) für den (Defensiv-)Fall
 * unit === 'portion'; gespeicherte defaultPortions sind sonst immer g/ml.
 */
export function describePortion(dp: NonNullable<FoodItem['defaultPortion']>, portionWord = 'Portion'): string {
  const base = `${dp.amount} ${dp.unit === 'portion' ? portionWord : dp.unit}`
  return dp.label ? `1 ${dp.label} (${base})` : base
}

/**
 * Mengen-Text eines Log-Eintrags für Listen (Heute/Woche): mit serving-
 * Snapshot „2 × Kappe (60 g)" — benannte Einheit UND Basis-Menge —, ohne
 * Snapshot schlicht „60 g". Dezimaltrennzeichen Komma („0,5 × EL (7,5 g)").
 * Pure Funktion — testbar ohne React-Baum; `portionWord` kommt aus i18n
 * (t('today.edit.unitPortion')) für unit === 'portion'.
 */
export function formatLogAmount(
  entry: Pick<LogEntry, 'amount' | 'unit' | 'serving'>,
  portionWord = 'Portion',
): string {
  const fmt = (n: number) => String(n).replace('.', ',')
  const base = `${fmt(entry.amount)} ${entry.unit === 'portion' ? portionWord : entry.unit}`
  return entry.serving ? `${fmt(entry.serving.count)} × ${entry.serving.label} (${base})` : base
}

/**
 * Hint für die Mengenschätzung per Foto (Analyse-Modus 'portion'):
 * Produktname + optional die gerade relevante Einheit als Kontext
 * („Whey Protein Powder. Menge in: Kappe"). Pure Funktion — hier statt in
 * PortionSheet.tsx, damit die Hint-Bildung ohne React-Baum testbar ist.
 * Server-Limit: hint max. 280 Zeichen (AnalyzeRequestSchema).
 */
export function portionPhotoHint(name: string, unitLabel?: string): string | undefined {
  const parts = [name.trim(), unitLabel?.trim() ? `Menge in: ${unitLabel.trim()}` : '']
  const hint = parts.filter(Boolean).join('. ')
  return hint ? hint.slice(0, 280) : undefined
}

/**
 * 'portion'-Antwort → konkrete Menge in der Basis-Einheit (gerundet, > 0).
 * `null`, wenn die KI nichts Verwertbares liefert (kein Item, unit 'portion'
 * ohne Gramm-Bezug, Menge ≤ 0) — der Aufrufer zeigt dann den Hinweis
 * „Keine Mengenschätzung erkennbar" (food.edit.portionEstimateNone).
 */
export function gramsFromPortionResult(result: Pick<AnalyzeResult, 'items'>): number | null {
  const item = result.items[0]
  if (!item || item.unit === 'portion') return null
  const grams = Math.round(item.amount)
  return grams > 0 ? grams : null
}
