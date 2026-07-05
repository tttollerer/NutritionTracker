import { describe, expect, it } from 'vitest'
import { lastNDayKeys, macroWeek, weeklyGoalHits } from './insights'
import type { DaySums } from './gamification'
import type { Goal } from '@/db/types'

const goal = (nutrient: string, type: Goal['type'], target: number, targetMax?: number): Goal => ({
  id: nutrient,
  nutrient,
  type,
  target,
  targetMax,
  unit: nutrient === 'kcal' ? 'kcal' : 'g',
  active: true,
  createdBy: 'user',
  updatedAt: 0,
})

const day = (kcal: number, protein = 0, carbs = 0, fat = 0): DaySums => ({ kcal, protein, carbs, fat })

describe('lastNDayKeys', () => {
  it('liefert n aufsteigende Tage, endend heute', () => {
    expect(lastNDayKeys('2026-07-05', 3)).toEqual(['2026-07-03', '2026-07-04', '2026-07-05'])
  })
  it('überspringt Monats-/Jahresgrenzen korrekt', () => {
    expect(lastNDayKeys('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02'])
    expect(lastNDayKeys('2026-01-01', 2)).toEqual(['2025-12-31', '2026-01-01'])
  })
})

describe('weeklyGoalHits', () => {
  const days = lastNDayKeys('2026-07-07', 7) // 2026-07-01 … 2026-07-07

  it('zählt min-Ziel-Treffer nur an Tagen mit erreichtem Wert', () => {
    const goals = { protein: goal('protein', 'min', 100) }
    const sums: Record<string, DaySums> = {
      '2026-07-01': day(0, 120),
      '2026-07-02': day(0, 99),
      '2026-07-05': day(0, 100),
    }
    const [p] = weeklyGoalHits(sums, goals, days)
    expect(p.nutrient).toBe('protein')
    expect(p.hits).toBe(2)
    expect(p.total).toBe(7)
    expect(p.metByDay).toEqual([true, false, false, false, true, false, false])
  })

  it('fehlende Tage zählen bei max-Zielen nicht als getroffen', () => {
    const goals = { kcal: goal('kcal', 'max', 2000) }
    const sums: Record<string, DaySums> = {
      '2026-07-03': day(1800),
      '2026-07-04': day(2400),
    }
    const [k] = weeklyGoalHits(sums, goals, days)
    // Nur der 03. trifft — die 5 leeren Tage sind Lücken, kein Erfolg.
    expect(k.hits).toBe(1)
  })

  it('range mit explizitem Korridor und mit ±15%-Toleranz', () => {
    const goals = {
      kcal: goal('kcal', 'range', 2000, 2200),
      fat: goal('fat', 'range', 60),
    }
    const sums: Record<string, DaySums> = {
      '2026-07-01': day(2100, 0, 0, 60), // beide getroffen
      '2026-07-02': day(2300, 0, 0, 65), // kcal drüber, fat innerhalb ±15% (51–69)
      '2026-07-03': day(2000, 0, 0, 40), // kcal untere Kante, fat drunter
    }
    const [k, f] = weeklyGoalHits(sums, goals, days)
    expect(k.nutrient).toBe('kcal')
    expect(k.hits).toBe(2)
    expect(f.nutrient).toBe('fat')
    expect(f.hits).toBe(2)
  })

  it('liefert nur Nährstoffe mit aktivem Ziel, in fester Reihenfolge', () => {
    const goals = { fat: goal('fat', 'range', 60), protein: goal('protein', 'min', 100) }
    const res = weeklyGoalHits({}, goals, days)
    expect(res.map((r) => r.nutrient)).toEqual(['protein', 'fat'])
    expect(res.every((r) => r.hits === 0)).toBe(true)
  })
})

describe('macroWeek', () => {
  const days = lastNDayKeys('2026-07-07', 7)

  it('mittelt nur über geloggte Tage', () => {
    const sums: Record<string, DaySums> = {
      '2026-07-01': day(2000, 100, 200, 60),
      '2026-07-04': day(1000, 50, 100, 30),
    }
    const { avg, loggedDays } = macroWeek(sums, days)
    expect(loggedDays).toBe(2)
    expect(avg.kcal).toBe(1500)
    expect(avg.protein).toBe(75)
    expect(avg.carbs).toBe(150)
    expect(avg.fat).toBe(45)
  })

  it('ohne geloggte Tage: 0-Werte statt NaN', () => {
    const { avg, loggedDays } = macroWeek({}, days)
    expect(loggedDays).toBe(0)
    expect(avg).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })
})
