import type { FoodItem, LogEntry, Meal, Unit } from '@/db/types'
import { computeLogValues, deleteLog, logFood } from '@/db/repo'
import { decrementPantryOnLog, incrementPantry } from '@/lib/pantryStock'
import { todayKey } from '@/lib/utils'

/**
 * Mehrfach-Log aus dem Vorrat (Quick-Sheet „Mehrere wählen"): ein Abendessen
 * aus mehreren Komponenten ist EIN Vorgang — alle gewählten Produkte werden
 * mit ihrer üblichen Portion geloggt, der Bestand zählt je Produkt runter
 * (decrementPantryOnLog) und EIN Undo nimmt alles zusammen zurück.
 */

/** Übliche Portion eines Foods: gemerkte defaultPortion, sonst 100 g/ml. */
export function usualPortion(food: FoodItem): { amount: number; unit: Unit } {
  return {
    amount: food.defaultPortion?.amount ?? 100,
    unit: food.defaultPortion?.unit ?? food.per,
  }
}

/** kcal der üblichen Portion — für das Footer-Label „N eintragen (~X kcal)". */
export function usualPortionKcal(food: FoodItem): number {
  const p = usualPortion(food)
  return computeLogValues(food, p.amount, p.unit).kcal
}

export interface MultiLogged {
  entry: LogEntry
  foodId: string
  /** true nur, wenn wirklich eine Packung abging — das Undo legt nur dann zurück. */
  took: boolean
}

/** Alle Foods mit üblicher Portion loggen; der Bestand zählt je Produkt runter. */
export async function logMany(foods: FoodItem[], meal: Meal, date = todayKey()): Promise<MultiLogged[]> {
  const out: MultiLogged[] = []
  for (const food of foods) {
    const p = usualPortion(food)
    const entry = await logFood({ food, date, meal, amount: p.amount, unit: p.unit })
    out.push({ entry, foodId: food.id, took: await decrementPantryOnLog(food.id) })
  }
  return out
}

/** Undo eines logMany: alle Logs löschen, abgezogene Packungen zurücklegen. */
export async function undoLogMany(logged: MultiLogged[]): Promise<void> {
  await Promise.all(
    logged.map(async ({ entry, foodId, took }) => {
      await deleteLog(entry.id)
      if (took) await incrementPantry(foodId)
    }),
  )
}
