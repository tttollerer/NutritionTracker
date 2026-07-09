import { describe, expect, it } from 'vitest'
import {
  addMonths,
  logCountByDay,
  monthGridCells,
  monthRange,
  weekdayLabels,
  yearMonthOfKey,
} from '@/lib/dayContext'

describe('CalendarSheet — pure Kalender-Helfer (lib/dayContext)', () => {
  it('yearMonthOfKey liest Jahr/Monat (0-basiert)', () => {
    expect(yearMonthOfKey('2026-07-09')).toEqual({ year: 2026, month: 6 })
  })

  it('addMonths blättert über Jahresgrenzen', () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(addMonths({ year: 2025, month: 11 }, 1)).toEqual({ year: 2026, month: 0 })
    expect(addMonths({ year: 2026, month: 6 }, -12)).toEqual({ year: 2025, month: 6 })
  })

  it('monthRange liefert die Dexie-Grenzen inkl. Schaltjahr-Februar', () => {
    expect(monthRange({ year: 2026, month: 6 })).toEqual({ start: '2026-07-01', end: '2026-07-31' })
    expect(monthRange({ year: 2024, month: 1 })).toEqual({ start: '2024-02-01', end: '2024-02-29' })
  })

  it('monthGridCells richtet den Monatsersten auf Wochenstart Montag aus', () => {
    // 01.07.2026 ist ein Mittwoch → 2 Füllzellen (Mo, Di), dann 31 Tage.
    const july = monthGridCells({ year: 2026, month: 6 })
    expect(july.slice(0, 3)).toEqual([null, null, '2026-07-01'])
    expect(july).toHaveLength(2 + 31)
    expect(july.at(-1)).toBe('2026-07-31')

    // 01.06.2026 ist ein Montag → keine Füllzellen.
    const june = monthGridCells({ year: 2026, month: 5 })
    expect(june[0]).toBe('2026-06-01')

    // 01.02.2026 ist ein Sonntag → 6 Füllzellen.
    expect(monthGridCells({ year: 2026, month: 1 }).indexOf('2026-02-01')).toBe(6)
  })

  it('logCountByDay zählt Einträge pro Tag und überspringt Soft-Deleted', () => {
    const map = logCountByDay([
      { date: '2026-07-03' },
      { date: '2026-07-03' },
      { date: '2026-07-05' },
      { date: '2026-07-04', deletedAt: 123 },
    ])
    expect(map.get('2026-07-03')).toBe(2)
    expect(map.get('2026-07-05')).toBe(1)
    expect(map.has('2026-07-04')).toBe(false)
  })

  it('weekdayLabels beginnt mit Montag (deutsch)', () => {
    const labels = weekdayLabels('de-DE')
    expect(labels).toHaveLength(7)
    expect(labels[0]).toMatch(/^Mo/)
    expect(labels[6]).toMatch(/^So/)
  })
})
