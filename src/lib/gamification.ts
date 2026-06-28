import type { Goal, LogEntry } from '@/db/types'

/**
 * Gamification-Engine (PLAN.md §9). Die Auswertung ist rein und idempotent:
 * Punkte/Level/Streaks werden jedes Mal aus den Roh-Logs neu berechnet, damit
 * nichts doppelt vergeben wird.
 */

export type DaySums = { kcal: number; protein: number; carbs: number; fat: number }
export type GoalsMap = Record<string, Goal>
const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat'] as const

/** Ist ein einzelnes Ziel an einem Tag erreicht? */
export function goalMet(goal: Goal | undefined, value: number): boolean {
  if (!goal) return false
  switch (goal.type) {
    case 'min':
      return value >= goal.target
    case 'max':
      return value > 0 && value <= goal.target
    case 'range': {
      // Mit explizitem targetMax ist es ein echter Korridor [target, targetMax].
      // Ohne (Makro-Ziel mit Einzelwert) eine Toleranzspanne ±15 %.
      const lo = goal.targetMax != null ? goal.target : goal.target * 0.85
      const hi = goal.targetMax ?? goal.target * 1.15
      return value >= lo && value <= hi
    }
  }
}

export interface DayStatus {
  met: Record<string, boolean>
  metCount: number
  success: boolean // kcal- UND Proteinziel erreicht
  perfect: boolean // alle vier erreicht
}

export function evaluateDay(sums: DaySums, goals: GoalsMap): DayStatus {
  const met: Record<string, boolean> = {}
  for (const n of NUTRIENTS) met[n] = goalMet(goals[n], sums[n])
  const metCount = NUTRIENTS.filter((n) => met[n]).length
  return {
    met,
    metCount,
    success: met.kcal && met.protein,
    perfect: NUTRIENTS.every((n) => met[n]),
  }
}

/** Tages-Summen je Datum aus Log-Einträgen. */
export function sumsByDate(logs: LogEntry[]): Record<string, DaySums> {
  const out: Record<string, DaySums> = {}
  for (const l of logs) {
    const d = (out[l.date] ??= { kcal: 0, protein: 0, carbs: 0, fat: 0 })
    d.kcal += l.computed.kcal
    d.protein += l.computed.protein
    d.carbs += l.computed.carbs
    d.fat += l.computed.fat
  }
  return out
}

function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export interface GamiStats {
  totalLogs: number
  distinctDays: number
  points: number
  level: number
  nextLevelAt: number
  overallStreak: number
  perfectEver: boolean
}

export const POINTS_PER_GOAL = 10
export const POINTS_PER_DAY = 5
export const POINTS_PER_LEVEL = 100

/** Gesamtauswertung aus allen Logs + Zielen. */
export function computeStats(
  logs: LogEntry[],
  goals: GoalsMap,
  today: string,
): GamiStats & { byDate: Record<string, DayStatus> } {
  const sums = sumsByDate(logs)
  const byDate: Record<string, DayStatus> = {}
  let points = 0
  let perfectEver = false

  for (const [date, s] of Object.entries(sums)) {
    const status = evaluateDay(s, goals)
    byDate[date] = status
    points += status.metCount * POINTS_PER_GOAL + POINTS_PER_DAY
    if (status.perfect) perfectEver = true
  }

  // Streak: aufeinanderfolgende erfolgreiche Tage, endend heute oder gestern.
  let cursor = byDate[today]?.success ? today : prevDay(today)
  let overallStreak = 0
  while (byDate[cursor]?.success) {
    overallStreak++
    cursor = prevDay(cursor)
  }

  const level = Math.floor(points / POINTS_PER_LEVEL) + 1
  return {
    totalLogs: logs.length,
    distinctDays: Object.keys(sums).length,
    points,
    level,
    nextLevelAt: level * POINTS_PER_LEVEL,
    overallStreak,
    perfectEver,
    byDate,
  }
}

/** Badge-Definitionen mit Prädikat über die Statistik + Roh-Logs. */
export interface BadgeDef {
  key: string
  predicate: (s: GamiStats, ctx: { sources: Set<string> }) => boolean
}

export const BADGES: BadgeDef[] = [
  { key: 'first_log', predicate: (s) => s.totalLogs >= 1 },
  { key: 'logged_7d', predicate: (s) => s.distinctDays >= 7 },
  { key: 'logged_30d', predicate: (s) => s.distinctDays >= 30 },
  { key: 'streak_3', predicate: (s) => s.overallStreak >= 3 },
  { key: 'streak_7', predicate: (s) => s.overallStreak >= 7 },
  { key: 'streak_30', predicate: (s) => s.overallStreak >= 30 },
  { key: 'perfect_day', predicate: (s) => s.perfectEver },
  { key: 'first_ai_scan', predicate: (_s, c) => c.sources.has('ai') },
  { key: 'first_barcode', predicate: (_s, c) => c.sources.has('openfoodfacts') },
]

/** Begleiter-Stufe & Stimmung aus Streak/heute. */
export function companionFrom(streak: number, todaySuccess: boolean, hasLoggedToday: boolean) {
  const stage = Math.min(4, Math.floor(streak / 3))
  const mood: 'happy' | 'ok' | 'sad' = todaySuccess ? 'happy' : hasLoggedToday ? 'ok' : 'sad'
  return { type: 'plant', stage, mood }
}
