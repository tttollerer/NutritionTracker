import type { LogEntry } from '@/db/types'
import { todayKey } from '@/lib/utils'

/**
 * Wochen-Karte (kcal-Balken Mo–So): pure Aggregation über bereits geladene
 * Logs — testbar ohne DB (Muster src/lib/budget.ts). planned-Einträge
 * (Wochenplan) und gelöschte zählen NIE als Verzehr.
 */

export interface WeekBar {
  /** Tag 'YYYY-MM-DD'. */
  date: string
  /** Verzehr-kcal des Tages, gerundet. */
  kcal: number
  /** Balken-Anteil bis zum Ziel, relativ zur Skala [0..1]. */
  basePct: number
  /** Über-Ziel-Anteil, relativ zur Skala [0..1] — warning-Farbe. */
  overPct: number
}

export interface WeekBarsData {
  bars: WeekBar[]
  /** Höhe der gestrichelten Ziellinie, relativ zur Skala [0..1]. */
  goalPct: number
}

/** Mo–So ('YYYY-MM-DD') der Woche, in der `dayKey` liegt (deutsche Konvention). */
export function weekDayKeys(dayKey: string): string[] {
  const [y, m, d] = dayKey.split('-').map(Number)
  const monday = new Date(y, m - 1, d)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)) // So=0 → 6, Mo=1 → 0, …
  return Array.from({ length: 7 }, (_, i) =>
    todayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  )
}

/**
 * kcal-Balken je Tag inkl. Skalierung: Skala ist max(Ziel, höchster Tag), damit
 * Über-Ziel-Tage nicht abgeschnitten werden und die Ziellinie mitwandert.
 * Logs außerhalb von `dayKeys` werden ignoriert.
 */
export function weekKcalBars(
  logs: Pick<LogEntry, 'date' | 'computed' | 'planned' | 'deletedAt'>[],
  dayKeys: string[],
  kcalGoal: number,
): WeekBarsData {
  const byDay = new Map(dayKeys.map((k) => [k, 0]))
  for (const l of logs) {
    if (l.deletedAt || l.planned) continue
    const cur = byDay.get(l.date)
    if (cur !== undefined) byDay.set(l.date, cur + l.computed.kcal)
  }
  const goal = Math.max(1, kcalGoal)
  const scale = Math.max(goal, ...byDay.values())
  return {
    goalPct: goal / scale,
    bars: dayKeys.map((date) => {
      const kcal = byDay.get(date)!
      return {
        date,
        kcal: Math.round(kcal),
        basePct: Math.min(kcal, goal) / scale,
        overPct: Math.max(0, kcal - goal) / scale,
      }
    }),
  }
}
