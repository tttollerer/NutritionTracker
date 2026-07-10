import type { FoodItem, LogEntry } from '@/db/types'
import { getSettings, updateSettings } from '@/db/repo'

/**
 * Budget & Preis-Auswertungen (Haushaltskasse-Ausbau). Die Auswertungen sind
 * pure Funktionen über bereits geladene Logs/Foods (testbar ohne DB) — nur das
 * Wochenbudget liest/schreibt Settings.
 */

/** Schlüssel für Kosten von Foods ohne Tags in costsByTag. */
export const UNTAGGED = 'untagged'

/** Wochenbudget (EUR) aus den Settings; undefined = kein Budget gesetzt. */
export async function getWeeklyBudget(): Promise<number | undefined> {
  return (await getSettings()).weeklyBudget
}

/** Wochenbudget setzen oder mit `undefined` entfernen (ungültige Werte entfernen). */
export async function setWeeklyBudget(eur?: number): Promise<void> {
  const valid = eur != null && Number.isFinite(eur) && eur > 0
  await updateSettings({ weeklyBudget: valid ? Math.round(eur * 100) / 100 : undefined })
}

/**
 * Kosten-Summen (EUR) je erstem Tag des Lebensmittels — „Wofür gebe ich Geld
 * aus?". Gelöschte/geplante Logs und Logs ohne Kosten-Snapshot zählen nicht;
 * Foods ohne Tags landen unter UNTAGGED. Werte auf Cent gerundet.
 */
export function costsByTag(logs: LogEntry[], foods: FoodItem[]): Record<string, number> {
  const tagByFood = new Map(foods.map((f) => [f.id, f.tags?.[0] ?? UNTAGGED]))
  const out: Record<string, number> = {}
  for (const l of logs) {
    if (l.deletedAt || l.planned || l.cost == null) continue
    const tag = tagByFood.get(l.foodId) ?? UNTAGGED
    out[tag] = Math.round(((out[tag] ?? 0) + l.cost) * 100) / 100
  }
  return out
}

export interface BudgetProgress {
  /** Verbrauchter Anteil, auf [0..1] geklemmt (für Fortschrittsbalken). */
  ratio: number
  /** true, wenn die Ausgaben das Budget übersteigen. */
  over: boolean
  /** Abstand zum Budget in EUR (Betrag): übrig bzw. Überschreitung. */
  diff: number
}

/** Ausgaben gegen das Wochenbudget stellen; ohne (gültiges) Budget undefined. */
export function budgetProgress(spent: number, budget?: number): BudgetProgress | undefined {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return undefined
  return {
    ratio: Math.min(1, Math.max(0, spent / budget)),
    over: spent > budget,
    diff: Math.round(Math.abs(budget - spent) * 100) / 100,
  }
}

/** Top-N Kategorien aus costsByTag, teuerste zuerst (für horizontale Balken). */
export function topCostTags(costs: Record<string, number>, n = 5): [string, number][] {
  return Object.entries(costs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

export interface FoodPriceRank {
  food: FoodItem
  /** EUR je 100 g Protein bzw. je 1000 kcal, auf Cent gerundet. */
  price: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Protein-Preisliste: EUR je 100 g Protein — nur Foods mit gültigem Preis und
 * protein > 0, günstigste zuerst („Wo bekomme ich Eiweiß am billigsten?").
 */
export function proteinPricePerFood(foods: FoodItem[]): FoodPriceRank[] {
  return foods
    .filter((f) => !f.deletedAt && f.protein > 0 && f.price && f.price.per > 0 && f.price.amount >= 0)
    .map((f) => ({
      // 100 g Protein stecken in 10000/protein g Produkt (protein = g je 100 g).
      food: f,
      price: round2((10000 / f.protein) * (f.price!.amount / f.price!.per)),
    }))
    .sort((a, b) => a.price - b.price)
}

/**
 * Kalorien-Preisliste: EUR je 1000 kcal — nur Foods mit gültigem Preis und
 * kcal > 0, günstigste zuerst.
 */
export function kcalPrice(foods: FoodItem[]): FoodPriceRank[] {
  return foods
    .filter((f) => !f.deletedAt && f.kcal > 0 && f.price && f.price.per > 0 && f.price.amount >= 0)
    .map((f) => ({
      // 1000 kcal stecken in 100000/kcal g Produkt (kcal = je 100 g).
      food: f,
      price: round2((100000 / f.kcal) * (f.price!.amount / f.price!.per)),
    }))
    .sort((a, b) => a.price - b.price)
}
