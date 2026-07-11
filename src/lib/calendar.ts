import { todayKey } from '@/lib/utils'

/**
 * Pure Kalender-Helfer für die Monatsansicht (CalendarSheet) und den Sprung
 * Kalender → Woche. Bewusst ohne Dexie/React — separat testbar, Muster
 * src/lib/weekBars.ts. Wochenstart ist Montag (deutsche Konvention, wie
 * mondayOf in Week.tsx).
 */

export interface YearMonth {
  year: number
  /** 0-basiert wie bei Date (0 = Januar). */
  month: number
}

/**
 * Blätter-Fenster des Monats-Pagers: 12 Monate zurück (Rückblick „was habe
 * ich gegessen") und 12 Monate vor — deckt den Planungshorizont des
 * Wochenplaners großzügig ab (Week selbst begrenzt weekOffset nicht).
 */
export const CALENDAR_MONTHS_BACK = 12
export const CALENDAR_MONTHS_FORWARD = 12

/** 'YYYY-MM-DD' → lokales Date (Mittag — DST-sicher für reine Datumsrechnung). */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/** Jahr/Monat eines 'YYYY-MM-DD'-Schlüssels. */
export function yearMonthOfKey(key: string): YearMonth {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month: m - 1 }
}

/** Monat um `delta` verschieben (Jahreswechsel inklusive). */
export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const dt = new Date(year, month + delta, 1)
  return { year: dt.getFullYear(), month: dt.getMonth() }
}

/** Fortlaufender Monatsindex — macht Fenster-Grenzen vergleichbar (atMin/atMax). */
export function monthIndex({ year, month }: YearMonth): number {
  return year * 12 + month
}

/** Erster/letzter Tag-Schlüssel eines Monats — Grenzen für die Dexie-Range-Query. */
export function monthRange({ year, month }: YearMonth): { start: string; end: string } {
  return { start: todayKey(new Date(year, month, 1)), end: todayKey(new Date(year, month + 1, 0)) }
}

/**
 * Zellen der Monatsansicht: führende `null`s richten den 1. des Monats auf
 * die Montag-Spalte aus, danach folgen die Tag-Schlüssel des Monats.
 */
export function monthGridCells({ year, month }: YearMonth): (string | null)[] {
  const first = new Date(year, month, 1)
  const mondayOffset = (first.getDay() + 6) % 7 // getDay(): 0 = Sonntag
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: mondayOffset }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(todayKey(new Date(year, month, d)))
  return cells
}

/** Tages-Status im Kalender: echte Logs vs. nur geplante (Wochenplan). */
export interface DayLogCounts {
  /** Echte (gegessene) Einträge — primary-Punkt. */
  logged: number
  /** Nur geplante Einträge (planned=true) — hohler Punkt. */
  planned: number
}

/**
 * Tag-Schlüssel → Zähler, getrennt nach echten und geplanten Einträgen.
 * Gelöschte (deletedAt) zählen nie — gleiche Filter wie überall.
 */
export function logCountByDay(
  logs: { date: string; deletedAt?: number; planned?: boolean }[],
): Map<string, DayLogCounts> {
  const out = new Map<string, DayLogCounts>()
  for (const l of logs) {
    if (l.deletedAt) continue
    const cur = out.get(l.date) ?? { logged: 0, planned: 0 }
    if (l.planned) cur.planned++
    else cur.logged++
    out.set(l.date, cur)
  }
  return out
}

/** Montag der Woche, in der `key` liegt (gleiche Konvention wie Week.tsx). */
export function mondayKeyOf(key: string): string {
  const d = dateFromKey(key)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // So=0 → 6, Mo=1 → 0, …
  return todayKey(d)
}

/**
 * weekOffset (Week.tsx-Semantik: 0 = aktuelle Woche, -1 = vorherige, …),
 * in dessen Woche `dateKey` liegt. UTC-Diff der Montage — DST-sicher.
 */
export function weekOffsetOf(dateKey: string, today: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(mondayKeyOf(dateKey)) - utc(mondayKeyOf(today))) / (7 * 86_400_000))
}

/** Mo–So-Kurzlabels aus Intl (2024-01-01 war ein Montag) — nichts hartkodiert. */
export function weekdayLabels(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  )
}
