import { describe, expect, it } from 'vitest'
import { computeStats, evaluateDay, goalMet } from './gamification'
import type { Goal, LogEntry } from '@/db/types'

const goal = (nutrient: string, type: Goal['type'], target: number, targetMax?: number): Goal => ({
  id: nutrient,
  nutrient,
  type,
  target,
  targetMax,
  unit: 'g',
  active: true,
  createdBy: 'user',
  updatedAt: 0,
})

const goals = {
  kcal: goal('kcal', 'range', 2000, 2200),
  protein: goal('protein', 'min', 150),
  carbs: goal('carbs', 'range', 200),
  fat: goal('fat', 'range', 60),
}

const log = (date: string, c: Partial<LogEntry['computed']>): LogEntry => ({
  id: date + Math.random(),
  foodId: 'f',
  date,
  meal: 'lunch',
  loggedAt: 0,
  amount: 100,
  unit: 'g',
  computed: { kcal: 0, protein: 0, carbs: 0, fat: 0, ...c },
  updatedAt: 0,
})

describe('goalMet', () => {
  it('min reached', () => {
    expect(goalMet(goals.protein, 150)).toBe(true)
    expect(goalMet(goals.protein, 149)).toBe(false)
  })
  it('max within', () => {
    expect(goalMet(goal('kcal', 'max', 2000), 1900)).toBe(true)
    expect(goalMet(goal('kcal', 'max', 2000), 2100)).toBe(false)
  })
  it('range tolerance (single target ±15%)', () => {
    expect(goalMet(goals.fat, 60)).toBe(true)
    expect(goalMet(goals.fat, 50)).toBe(false) // unter 85%
  })
  it('explicit corridor uses target as hard lower bound', () => {
    const corridor = goal('protein', 'range', 150, 200)
    expect(goalMet(corridor, 150)).toBe(true)
    expect(goalMet(corridor, 200)).toBe(true)
    expect(goalMet(corridor, 130)).toBe(false) // nicht um 15% aufweichen
    expect(goalMet(corridor, 210)).toBe(false)
  })
})

describe('evaluateDay', () => {
  it('marks a perfect day', () => {
    const s = evaluateDay({ kcal: 2100, protein: 160, carbs: 200, fat: 60 }, goals)
    expect(s.perfect).toBe(true)
    expect(s.success).toBe(true)
    expect(s.metCount).toBe(4)
  })
})

describe('computeStats', () => {
  it('counts a two-day streak ending today', () => {
    const logs = [
      log('2026-06-26', { kcal: 2100, protein: 160 }),
      log('2026-06-27', { kcal: 2100, protein: 160 }),
    ]
    const s = computeStats(logs, goals, '2026-06-27')
    expect(s.overallStreak).toBe(2)
    expect(s.distinctDays).toBe(2)
    expect(s.level).toBeGreaterThanOrEqual(1)
  })

  it('keeps streak when today is not done yet', () => {
    const logs = [log('2026-06-26', { kcal: 2100, protein: 160 })]
    const s = computeStats(logs, goals, '2026-06-27')
    expect(s.overallStreak).toBe(1) // gestern erfolgreich, heute noch offen
  })
})
