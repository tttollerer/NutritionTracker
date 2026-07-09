import { describe, expect, it } from 'vitest'
import { computeDayNutrition, overridesFromGoals } from './deficit'
import { sumsByDate } from './gamification'
import type { Goal, LogEntry } from '@/db/types'

function goal(partial: Partial<Goal> & Pick<Goal, 'nutrient' | 'type' | 'target'>): Goal {
  return {
    id: `g-${partial.nutrient}`,
    unit: 'g',
    active: true,
    createdBy: 'coach',
    updatedAt: 0,
    ...partial,
  }
}

function log(micros: Record<string, number>): LogEntry {
  return {
    id: 'l1',
    foodId: 'f1',
    date: '2026-07-09',
    meal: 'lunch',
    loggedAt: 0,
    amount: 100,
    unit: 'g',
    computed: { kcal: 300, protein: 10, carbs: 40, fat: 8, micros },
    updatedAt: 0,
  }
}

describe('overridesFromGoals (Vertrag v1.2: Coach-Ziele → Nährstoff-Anzeige)', () => {
  it('mappt ein sugar-Max-Ziel auf limitOverrides und fiber-Min auf benefitOverrides', () => {
    const { limitOverrides, benefitOverrides } = overridesFromGoals({
      sugar: goal({ nutrient: 'sugar', type: 'max', target: 30 }),
      fiber: goal({ nutrient: 'fiber', type: 'min', target: 40 }),
      sodium: goal({ nutrient: 'sodium', type: 'max', target: 1500, unit: 'mg' }),
      kcal: goal({ nutrient: 'kcal', type: 'max', target: 2000, unit: 'kcal' }),
    })
    expect(limitOverrides).toEqual({ sugar: 30, sodium: 1500 })
    expect(benefitOverrides).toEqual({ fiber: 40 })
  })

  it('ignoriert inaktive Ziele', () => {
    const { limitOverrides } = overridesFromGoals({
      sugar: goal({ nutrient: 'sugar', type: 'max', target: 30, active: false }),
    })
    expect(limitOverrides).toEqual({})
  })

  it('range-Limit nutzt targetMax als Obergrenze', () => {
    const { limitOverrides } = overridesFromGoals({
      sugar: goal({ nutrient: 'sugar', type: 'range', target: 20, targetMax: 40 }),
    })
    expect(limitOverrides).toEqual({ sugar: 40 })
  })
})

describe('computeDayNutrition mit Coach-Overrides', () => {
  it('übernommenes sugar-Ziel erscheint als Limit mit der Zielgrenze', () => {
    const { limitOverrides } = overridesFromGoals({
      sugar: goal({ nutrient: 'sugar', type: 'max', target: 30 }),
    })
    const day = computeDayNutrition([log({ sugar: 22 })], '2026-07-09', { limitOverrides })

    const sugar = day.limits.find((l) => l.key === 'sugar')!
    expect(sugar.target).toBe(30) // statt Katalog-Referenz 50
    expect(sugar.consumed).toBe(22)
    expect(sugar.remaining).toBe(8)
  })

  it('fiber-Min-Ziel überschreibt die Katalog-Referenz als Benefit-Ziel', () => {
    const { benefitOverrides } = overridesFromGoals({
      fiber: goal({ nutrient: 'fiber', type: 'min', target: 40 }),
    })
    const day = computeDayNutrition([log({ fiber: 10 })], '2026-07-09', { benefitOverrides })

    const fiber = day.benefits.find((b) => b.key === 'fiber')!
    expect(fiber.target).toBe(40) // statt Referenz 30
    expect(fiber.remaining).toBe(30)
  })
})

describe('sumsByDate trackt sugar/fiber/sodium aus den micros (Vertrag v1.2)', () => {
  it('summiert die Challenge-Nährstoffe je Tag', () => {
    const sums = sumsByDate([log({ sugar: 12, fiber: 5, sodium: 800 }), log({ sugar: 8 })])
    expect(sums['2026-07-09']).toMatchObject({ sugar: 20, fiber: 5, sodium: 800 })
    // Makros bleiben unverändert summiert.
    expect(sums['2026-07-09'].kcal).toBe(600)
  })

  it('lässt die Felder weg, wenn keine micros geloggt sind', () => {
    const sums = sumsByDate([log({})])
    expect(sums['2026-07-09'].sugar).toBeUndefined()
  })
})
