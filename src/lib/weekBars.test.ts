import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/db/types'
import { weekDayKeys, weekKcalBars } from './weekBars'

const log = (over: Partial<LogEntry>): LogEntry => ({
  id: over.id ?? 'l',
  foodId: 'f',
  date: '2026-07-06',
  meal: 'lunch',
  loggedAt: 0,
  amount: 100,
  unit: 'g',
  computed: { kcal: 500, protein: 10, carbs: 10, fat: 2 },
  updatedAt: 0,
  ...over,
})

describe('weekDayKeys', () => {
  it('liefert Mo–So der Woche (deutsche Konvention, So gehört zur Vorwoche)', () => {
    // 2026-07-10 ist ein Freitag → Woche 06.–12. Juli.
    const expected = [
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]
    expect(weekDayKeys('2026-07-10')).toEqual(expected)
    expect(weekDayKeys('2026-07-06')).toEqual(expected) // Montag selbst
    expect(weekDayKeys('2026-07-12')).toEqual(expected) // Sonntag → Vorwoche
  })

  it('funktioniert über Monatsgrenzen', () => {
    expect(weekDayKeys('2026-08-01')[0]).toBe('2026-07-27')
    expect(weekDayKeys('2026-08-01')[6]).toBe('2026-08-02')
  })
})

describe('weekKcalBars', () => {
  const days = weekDayKeys('2026-07-10')

  it('summiert je Tag; planned/deleted und fremde Tage zählen nicht', () => {
    const logs = [
      log({ id: '1', date: '2026-07-06', computed: { kcal: 800, protein: 0, carbs: 0, fat: 0 } }),
      log({ id: '2', date: '2026-07-06', computed: { kcal: 400, protein: 0, carbs: 0, fat: 0 } }),
      log({ id: '3', date: '2026-07-07', planned: true }), // nur geplant
      log({ id: '4', date: '2026-07-07', deletedAt: 1 }), // gelöscht
      log({ id: '5', date: '2026-06-30' }), // Vorwoche
    ]
    const { bars } = weekKcalBars(logs, days, 2000)
    expect(bars.map((b) => b.kcal)).toEqual([1200, 0, 0, 0, 0, 0, 0])
  })

  it('skaliert auf das Ziel, solange kein Tag darüber liegt', () => {
    const logs = [log({ id: '1', computed: { kcal: 1000, protein: 0, carbs: 0, fat: 0 } })]
    const { bars, goalPct } = weekKcalBars(logs, days, 2000)
    // Ziellinie ganz oben, Balken auf halber Höhe, kein Über-Anteil.
    expect(goalPct).toBe(1)
    expect(bars[0]).toEqual({ date: '2026-07-06', kcal: 1000, basePct: 0.5, overPct: 0 })
  })

  it('teilt Über-Ziel-Tage in Basis- und warning-Anteil und senkt die Ziellinie', () => {
    const logs = [log({ id: '1', computed: { kcal: 2500, protein: 0, carbs: 0, fat: 0 } })]
    const { bars, goalPct } = weekKcalBars(logs, days, 2000)
    // Skala = 2500: Ziellinie bei 80 %, Basis 80 %, Überschuss 20 %.
    expect(goalPct).toBe(0.8)
    expect(bars[0].basePct).toBe(0.8)
    expect(bars[0].overPct).toBeCloseTo(0.2)
    // Basis + Überschuss ergeben die volle Balkenhöhe.
    expect(bars[0].basePct + bars[0].overPct).toBeCloseTo(1)
  })

  it('kommt mit leeren Logs und unbrauchbarem Ziel klar', () => {
    const { bars, goalPct } = weekKcalBars([], days, 0)
    expect(goalPct).toBe(1)
    expect(bars.every((b) => b.kcal === 0 && b.basePct === 0 && b.overPct === 0)).toBe(true)
  })
})
