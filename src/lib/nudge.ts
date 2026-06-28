import type { DayNutrition, NutrientStatus } from './deficit'
import type { FoodSuggestion } from './recommend'

/**
 * Proaktive In-App-Nudges (H6, PLAN §9.3). Rein & regelbasiert: aus dem heutigen
 * Nährstoffbild + Tageszeit wird höchstens EIN priorisierter Hinweis abgeleitet —
 * eine Warnung bei überschrittenem Limit, ein Anstupser bei offenem Defizit oder
 * ein Lob. Der Coach/das LLM wird hierfür NICHT gebraucht.
 */
export type NudgeTone = 'warn' | 'info' | 'success'
export type NudgeType = 'limitOver' | 'proteinEvening' | 'microDeficit' | 'noLogYet' | 'allMet'

export interface Nudge {
  tone: NudgeTone
  type: NudgeType
  params?: Record<string, string | number>
  /** Optionaler Ein-Tipp-Vorschlag (aus der Empfehlungs-Engine). */
  foodId?: string
  foodName?: string
}

export interface NudgeInput {
  hour: number // 0..23
  hasLoggedToday: boolean
  day: DayNutrition
  deficits: NutrientStatus[] // rankDeficits(day)
  topRec?: FoodSuggestion
}

export function buildNudge(input: NudgeInput): Nudge | null {
  const { hour, hasLoggedToday, day, deficits, topRec } = input

  // 1) Limit überschritten → Warnung (stärkste Überschreitung zuerst).
  const over = day.limits.filter((l) => l.remaining < 0).sort((a, b) => a.remaining - b.remaining)[0]
  if (over) {
    return { tone: 'warn', type: 'limitOver', params: { nutrient: over.key, over: round1(-over.remaining), unit: over.unit } }
  }

  // 2) Abends + nennenswertes Protein-Defizit → eiweißreiche Mahlzeit anstupsen.
  const protein = day.benefits.find((b) => b.key === 'protein')
  if (hour >= 17 && protein && protein.remaining > 15 && protein.pct < 0.85) {
    return withFood({ tone: 'info', type: 'proteinEvening', params: { remaining: Math.round(protein.remaining), unit: protein.unit } }, topRec)
  }

  // 3) Nachmittags/abends + deutliches Mikro-Defizit → konkreten Vorschlag.
  const microDef = deficits.find((d) => d.key !== 'protein' && d.pct < 0.6)
  if (hour >= 14 && microDef) {
    return withFood({ tone: 'info', type: 'microDeficit', params: { nutrient: microDef.key } }, topRec)
  }

  // 4) Mittag erreicht, noch nichts erfasst → ans Loggen erinnern.
  if (hour >= 11 && !hasLoggedToday) {
    return { tone: 'info', type: 'noLogYet' }
  }

  // 5) Abends, alle Benefit-Ziele erreicht → loben.
  const allMet = day.benefits.every((b) => b.remaining <= 0 || b.pct >= 1)
  if (hasLoggedToday && hour >= 17 && allMet && deficits.length === 0) {
    return { tone: 'success', type: 'allMet' }
  }

  return null
}

function withFood(n: Nudge, rec?: FoodSuggestion): Nudge {
  return rec ? { ...n, foodId: rec.food.id, foodName: rec.food.name } : n
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
