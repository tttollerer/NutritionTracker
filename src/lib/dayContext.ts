import { useSyncExternalStore } from 'react'
import { todayKey } from '@/lib/utils'

/**
 * Aktives Zieldatum fürs Nachtragen (Kalender/Tages-Navigation auf „Heute").
 *
 * Winziger Store ohne globalen State-Manager: der Wert liegt in sessionStorage
 * (übersteht einen Reload, aber bewusst keinen App-Neustart — niemand soll
 * Tage später versehentlich noch „in der Vergangenheit" loggen) und Komponenten
 * abonnieren ihn über useSyncExternalStore.
 *
 * Regeln:
 *  - Kein gesetzter Wert (oder Wert == heute) → getActiveDate() fällt auf
 *    todayKey() zurück; die „Heute"-Ansicht folgt damit automatisch dem
 *    Mitternachtswechsel (useTodayKey triggert das Re-Render).
 *  - Nur bei manuell gewähltem Tag bleibt der Tag stehen.
 *  - Schreibpfade (Add.tsx) lesen im Moment des Speicherns frisch per
 *    getActiveDate() — nie einen eingefrorenen Render-Wert.
 */

const STORAGE_KEY = 'nutriscan.activeDate'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const listeners = new Set<() => void>()

function readStored(): string | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY)
    return v && DATE_RE.test(v) ? v : null
  } catch {
    return null // sessionStorage nicht verfügbar (z. B. Privacy-Modus)
  }
}

/** Aktives Zieldatum ('YYYY-MM-DD'); Fallback: heute. Zukunftswerte zählen nicht. */
export function getActiveDate(): string {
  const stored = readStored()
  const today = todayKey()
  return stored && stored < today ? stored : today
}

/**
 * Zieldatum setzen. `null` (oder heute/ungültig) löscht den Override —
 * die App ist damit wieder „auf heute".
 */
export function setActiveDate(date: string | null): void {
  try {
    if (date && DATE_RE.test(date) && date < todayKey()) {
      sessionStorage.setItem(STORAGE_KEY, date)
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // ohne sessionStorage bleibt der Store schlicht auf „heute"
  }
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Reaktiver Hook auf das aktive Zieldatum (Fallback heute). */
export function useActiveDate(): string {
  return useSyncExternalStore(subscribe, getActiveDate, getActiveDate)
}

// ---- Datums-Helfer für die Tages-Navigation (lokal, DST-sicher) ----

/** 'YYYY-MM-DD' → lokales Date (Mitternacht). */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Tag-Schlüssel um `delta` Tage verschieben (setDate ist DST-sicher). */
export function shiftDayKey(key: string, delta: number): string {
  const dt = dateFromKey(key)
  dt.setDate(dt.getDate() + delta)
  return todayKey(dt)
}

/** „Mittwoch, 03.07." — Banner-Format (Heute-Banner, Nachtragen-Banner). */
export function formatDayLong(key: string, locale = 'de-DE'): string {
  return dateFromKey(key).toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: '2-digit' })
}

/** „Mi., 03.07." — kompaktes Format für den Datums-Button im Kopf. */
export function formatDayShort(key: string, locale = 'de-DE'): string {
  return dateFromKey(key).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
}

// ---- Pure Kalender-Helfer (Monatsansicht CalendarSheet; separat testbar) ----

export interface YearMonth {
  year: number
  /** 0-basiert wie bei Date (0 = Januar). */
  month: number
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

/** Erster/letzter Tag-Schlüssel eines Monats — Grenzen für die Dexie-Range-Query. */
export function monthRange({ year, month }: YearMonth): { start: string; end: string } {
  return { start: todayKey(new Date(year, month, 1)), end: todayKey(new Date(year, month + 1, 0)) }
}

/**
 * Zellen der Monatsansicht: führende `null`s richten den 1. des Monats auf
 * eine Wochenstart-Montag-Spalte aus, danach folgen die Tag-Schlüssel.
 */
export function monthGridCells({ year, month }: YearMonth): (string | null)[] {
  const first = new Date(year, month, 1)
  const mondayOffset = (first.getDay() + 6) % 7 // getDay(): 0 = Sonntag
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: mondayOffset }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(todayKey(new Date(year, month, d)))
  return cells
}

/** Tage-mit-Logs-Map: Tag-Schlüssel → Anzahl (nicht gelöschter) Einträge. */
export function logCountByDay(logs: { date: string; deletedAt?: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of logs) {
    if (l.deletedAt) continue
    out.set(l.date, (out.get(l.date) ?? 0) + 1)
  }
  return out
}

/** Mo–So-Kurzlabels aus Intl (2024-01-01 war ein Montag) — nichts hartkodiert. */
export function weekdayLabels(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  )
}
