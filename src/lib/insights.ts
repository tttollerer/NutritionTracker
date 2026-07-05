import type { Goal } from '@/db/types'
import { goalMet, type DaySums, type GoalsMap } from './gamification'

/**
 * Wochen-Insights für den Verlauf (PLAN.md §7.5): pure Auswertung von
 * Tages-Summen (sumsByDate) gegen die aktiven Ziele. Die Bewertungslogik
 * (min/max/range) kommt aus gamification.goalMet — hier wird nur gezählt.
 */

export const TRACKED_NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat'] as const
export type TrackedNutrient = (typeof TRACKED_NUTRIENTS)[number]

/** Aufsteigende Tages-Keys ('YYYY-MM-DD'), endend inklusive bei `today`. */
export function lastNDayKeys(today: string, n: number): string[] {
  const [y, m, d] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1, d - i)
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

export interface GoalHits {
  nutrient: TrackedNutrient
  goal: Goal
  /** Pro Tag im Fenster (gleiche Reihenfolge wie `days`): Ziel getroffen? */
  metByDay: boolean[]
  hits: number
  total: number
}

/**
 * Pro aktivem kcal-/Makro-Ziel: an wie vielen der übergebenen Tage wurde es
 * getroffen? Tage ohne Logs zählen NIE als getroffen — auch nicht bei
 * max-Zielen (kein Eintrag ist kein Erfolg, sondern eine Lücke).
 */
export function weeklyGoalHits(
  sums: Record<string, DaySums>,
  goals: GoalsMap,
  days: string[],
): GoalHits[] {
  const out: GoalHits[] = []
  for (const nutrient of TRACKED_NUTRIENTS) {
    const goal = goals[nutrient]
    if (!goal) continue
    const metByDay = days.map((day) => {
      const s = sums[day]
      if (!s) return false
      return goalMet(goal, s[nutrient])
    })
    out.push({
      nutrient,
      goal,
      metByDay,
      hits: metByDay.filter(Boolean).length,
      total: days.length,
    })
  }
  return out
}

export interface MacroWeek {
  /** Ø pro geloggtem Tag; 0 wenn kein Tag geloggt. */
  avg: DaySums
  /** Anzahl Tage im Fenster mit mindestens einem Log. */
  loggedDays: number
}

/**
 * Ø-Tageswerte über die Tage MIT Logs im Fenster — leere Tage verwässern den
 * Schnitt nicht, dafür wird `loggedDays` separat ausgewiesen.
 */
export function macroWeek(sums: Record<string, DaySums>, days: string[]): MacroWeek {
  const logged = days.filter((d) => sums[d])
  const avg: DaySums = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  for (const d of logged) {
    const s = sums[d]
    avg.kcal += s.kcal
    avg.protein += s.protein
    avg.carbs += s.carbs
    avg.fat += s.fat
  }
  if (logged.length > 0) {
    avg.kcal /= logged.length
    avg.protein /= logged.length
    avg.carbs /= logged.length
    avg.fat /= logged.length
  }
  return { avg, loggedDays: logged.length }
}
