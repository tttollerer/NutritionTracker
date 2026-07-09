import type { FoodItem } from '@/db/types'

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
