import { FOOD_CATALOG, type CatalogFood } from './foodCatalog'
import type { NutrientStatus } from './deficit'

/**
 * Deterministische Empfehlungs-Engine ("was soll ich noch essen?").
 * Scort den kuratierten Katalog danach, wie gut eine übliche Portion die
 * offenen Defizite schließt — gefiltert nach Ernährungsform & Allergien,
 * ohne LLM. Der Coach formuliert daraus optional einen Nudge.
 */
export interface FoodSuggestion {
  food: CatalogFood
  /** Welche Defizit-Nährstoffe diese Portion nennenswert deckt (key → Menge). */
  covers: { key: string; amount: number; unit: string }[]
  score: number
}

export interface RecommendOpts {
  vegan?: boolean
  allergies?: string[]
  proteinKey?: boolean // Protein als Makro mit einbeziehen
  limit?: number
}

export function recommendFoods(deficits: NutrientStatus[], opts: RecommendOpts = {}): FoodSuggestion[] {
  const wanted = deficits.filter((d) => d.remaining > 0)
  if (wanted.length === 0) return []
  const allergies = new Set((opts.allergies ?? []).map((a) => a.toLowerCase()))

  const suggestions: FoodSuggestion[] = []
  for (const food of FOOD_CATALOG) {
    if (food.vice) continue // Laster nie empfehlen
    if (opts.vegan && !food.vegan) continue
    if (food.allergens.some((a) => allergies.has(a.toLowerCase()))) continue

    const factor = food.serving / 100
    const covers: FoodSuggestion['covers'] = []
    let score = 0

    for (const d of wanted) {
      const per100 = d.key === 'protein' ? food.protein : (food.micros[d.key] ?? 0)
      if (per100 <= 0) continue
      const contributed = per100 * factor
      // Beitrag relativ zum noch fehlenden Bedarf, gekappt bei 1 (kein Overshoot-Bonus).
      const rel = Math.min(contributed / d.remaining, 1)
      // Seltene Defizite (kleiner pct) stärker gewichten.
      score += rel * (1 - d.pct)
      if (rel >= 0.1) covers.push({ key: d.key, amount: round1(contributed), unit: d.unit })
    }

    if (covers.length > 0) suggestions.push({ food, covers, score })
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 4)
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
