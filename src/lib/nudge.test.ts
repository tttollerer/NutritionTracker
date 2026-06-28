import { describe, expect, it } from 'vitest'
import type { DayNutrition, NutrientStatus } from './deficit'
import type { FoodSuggestion } from './recommend'
import { buildNudge } from './nudge'

const benefit = (key: string, remaining: number, pct: number): NutrientStatus => ({
  key,
  unit: key === 'protein' ? 'g' : 'mg',
  kind: 'benefit',
  consumed: 0,
  target: 100,
  remaining,
  pct,
})
const limit = (key: string, remaining: number): NutrientStatus => ({
  key,
  unit: 'g',
  kind: 'limit',
  consumed: 0,
  target: 0,
  remaining,
  pct: 0,
})
const day = (benefits: NutrientStatus[], limits: NutrientStatus[] = []): DayNutrition => ({ benefits, limits })
const rec = { food: { id: 'lentils', name: 'Linsen' }, covers: [], score: 1 } as unknown as FoodSuggestion

describe('buildNudge', () => {
  it('prioritises an exceeded limit as a warning', () => {
    const n = buildNudge({ hour: 20, hasLoggedToday: true, day: day([benefit('protein', 0, 1)], [limit('alcohol', -9)]), deficits: [] })
    expect(n).toMatchObject({ tone: 'warn', type: 'limitOver', params: { nutrient: 'alcohol', over: 9 } })
  })

  it('nudges protein in the evening with a food suggestion', () => {
    const p = benefit('protein', 40, 0.6)
    const n = buildNudge({ hour: 18, hasLoggedToday: true, day: day([p]), deficits: [p], topRec: rec })
    expect(n).toMatchObject({ tone: 'info', type: 'proteinEvening', params: { remaining: 40 }, foodId: 'lentils' })
  })

  it('suggests for a clear micro deficit in the afternoon', () => {
    const iron = benefit('iron', 5, 0.3)
    const n = buildNudge({ hour: 15, hasLoggedToday: true, day: day([benefit('protein', 0, 1), iron]), deficits: [iron], topRec: rec })
    expect(n).toMatchObject({ type: 'microDeficit', params: { nutrient: 'iron' } })
  })

  it('reminds to log when nothing is tracked by midday', () => {
    const n = buildNudge({ hour: 12, hasLoggedToday: false, day: day([]), deficits: [] })
    expect(n).toMatchObject({ type: 'noLogYet' })
  })

  it('stays silent early in the morning', () => {
    expect(buildNudge({ hour: 8, hasLoggedToday: false, day: day([]), deficits: [] })).toBeNull()
  })

  it('celebrates when all benefit goals are met in the evening', () => {
    const n = buildNudge({ hour: 19, hasLoggedToday: true, day: day([benefit('protein', 0, 1.1)]), deficits: [] })
    expect(n).toMatchObject({ tone: 'success', type: 'allMet' })
  })
})
