import { describe, expect, it } from 'vitest'
import {
  addMonths,
  dateFromKey,
  logCountByDay,
  mondayKeyOf,
  monthGridCells,
  monthIndex,
  monthRange,
  weekdayLabels,
  weekOffsetOf,
  yearMonthOfKey,
} from './calendar'

describe('Kalender-Helfer (Monatsansicht)', () => {
  it('yearMonthOfKey / dateFromKey lesen den Tag-Schlüssel lokal', () => {
    expect(yearMonthOfKey('2026-07-11')).toEqual({ year: 2026, month: 6 })
    const d = dateFromKey('2026-07-11')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 11])
  })

  it('addMonths verschiebt über Jahresgrenzen', () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(addMonths({ year: 2025, month: 11 }, 1)).toEqual({ year: 2026, month: 0 })
    expect(addMonths({ year: 2026, month: 6 }, -12)).toEqual({ year: 2025, month: 6 })
  })

  it('monthIndex macht Monate vergleichbar (Fenster-Grenzen)', () => {
    expect(monthIndex({ year: 2026, month: 0 }) - monthIndex({ year: 2025, month: 11 })).toBe(1)
  })

  it('monthRange liefert ersten/letzten Tag des Monats', () => {
    expect(monthRange({ year: 2026, month: 6 })).toEqual({ start: '2026-07-01', end: '2026-07-31' })
    // Februar (kein Schaltjahr) endet am 28.
    expect(monthRange({ year: 2026, month: 1 })).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('monthGridCells richtet den 1. auf die Montag-Spalte aus', () => {
    // Juli 2026 beginnt an einem Mittwoch → 2 Leerzellen (Mo, Di).
    const july = monthGridCells({ year: 2026, month: 6 })
    expect(july.slice(0, 3)).toEqual([null, null, '2026-07-01'])
    expect(july).toHaveLength(2 + 31)
    expect(july[july.length - 1]).toBe('2026-07-31')

    // Februar 2026 beginnt an einem Sonntag → 6 Leerzellen.
    const feb = monthGridCells({ year: 2026, month: 1 })
    expect(feb.filter((c) => c === null)).toHaveLength(6)
    expect(feb[6]).toBe('2026-02-01')
  })

  it('logCountByDay trennt echte von geplanten Einträgen und filtert Gelöschte', () => {
    const counts = logCountByDay([
      { date: '2026-07-10' },
      { date: '2026-07-10', planned: true },
      { date: '2026-07-10', deletedAt: 1 }, // gelöscht → zählt nie
      { date: '2026-07-12', planned: true },
    ])
    expect(counts.get('2026-07-10')).toEqual({ logged: 1, planned: 1 })
    expect(counts.get('2026-07-12')).toEqual({ logged: 0, planned: 1 })
    expect(counts.get('2026-07-11')).toBeUndefined()
  })

  it('mondayKeyOf liefert den Montag der Woche (So gehört zur Vorwoche-Montag)', () => {
    expect(mondayKeyOf('2026-07-06')).toBe('2026-07-06') // Montag selbst
    expect(mondayKeyOf('2026-07-11')).toBe('2026-07-06') // Samstag
    expect(mondayKeyOf('2026-07-12')).toBe('2026-07-06') // Sonntag
    expect(mondayKeyOf('2026-07-13')).toBe('2026-07-13') // nächster Montag
  })

  it('weekOffsetOf: Week.tsx-Semantik (0 = aktuelle, -1 = vorherige Woche)', () => {
    const today = '2026-07-11' // Samstag
    expect(weekOffsetOf('2026-07-06', today)).toBe(0) // Montag derselben Woche
    expect(weekOffsetOf('2026-07-12', today)).toBe(0) // Sonntag derselben Woche
    expect(weekOffsetOf('2026-07-05', today)).toBe(-1) // Sonntag der Vorwoche
    expect(weekOffsetOf('2026-07-13', today)).toBe(1) // Montag der Folgewoche
    expect(weekOffsetOf('2026-06-01', today)).toBe(-5) // Monatsgrenze zurück (Mo, 5 Wochen)
  })

  it('weekdayLabels beginnt auf Deutsch mit Montag', () => {
    const labels = weekdayLabels('de-DE')
    expect(labels).toHaveLength(7)
    expect(labels[0]).toMatch(/^Mo/)
    expect(labels[6]).toMatch(/^So/)
  })
})
