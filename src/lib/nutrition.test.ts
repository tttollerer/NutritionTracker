import { describe, expect, it } from 'vitest'
import { bmr, computeTargets, kcalFloor, targetKcal } from './nutrition'
import type { Profile } from '@/db/types'

const base: Profile = {
  id: 'me',
  sex: 'm',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'medium',
  goal: 'maintain',
  persona: 'strength',
  dietForms: [],
  updatedAt: 0,
}

describe('nutrition', () => {
  it('computes Mifflin-St-Jeor BMR', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(bmr(base)).toBe(1780)
  })

  it('applies activity factor and goal delta', () => {
    expect(targetKcal(base)).toBe(2760) // 1780 * 1.55 = 2759 -> gerundet 2760
    expect(targetKcal({ ...base, goal: 'lose' })).toBe(2260)
  })

  it('derives protein from persona (g/kg)', () => {
    const t = computeTargets(base)
    expect(t.protein).toBe(160) // strength = 2.0 g/kg * 80
    expect(t.carbs).toBeGreaterThan(0)
    expect(t.fat).toBeGreaterThan(0)
  })

  it('caps carbs hard on keto', () => {
    const t = computeTargets({ ...base, dietForms: ['keto'] })
    expect(t.carbs).toBe(30)
  })

  it('never sets a kcal target below the safety floor', () => {
    // Kleine Frau mit aggressivem Defizit: das rohe Ziel läge gefährlich niedrig.
    const small: Profile = { ...base, sex: 'f', heightCm: 160, weightKg: 55, activity: 'low', goal: 'lose' }
    const floor = kcalFloor(small)
    expect(targetKcal(small)).toBeGreaterThanOrEqual(floor)
    // Floor liegt nie unter dem Grundumsatz.
    expect(floor).toBeGreaterThanOrEqual(bmr(small))
  })
})
