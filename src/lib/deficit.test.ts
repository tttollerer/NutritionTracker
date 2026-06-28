import { describe, expect, it } from 'vitest'
import { microsFromOff } from './nutrients'
import { computeDayNutrition, rankDeficits } from './deficit'
import { recommendFoods } from './recommend'
import type { LogEntry } from '@/db/types'

const log = (date: string, micros: Record<string, number>, protein = 0): LogEntry => ({
  id: date + Math.random(),
  foodId: 'f',
  date,
  meal: 'lunch',
  loggedAt: 0,
  amount: 100,
  unit: 'g',
  computed: { kcal: 0, protein, carbs: 0, fat: 0, micros },
  updatedAt: 0,
})

describe('microsFromOff', () => {
  it('converts OFF gram-based minerals to our units', () => {
    const m = microsFromOff({ 'iron_100g': 0.0021, 'calcium_100g': 0.12, 'vitamin-b12_100g': 0.0000007, 'sodium_100g': 0.4 })
    expect(m.iron).toBeCloseTo(2.1, 1) // 0.0021 g → 2.1 mg
    expect(m.calcium).toBeCloseTo(120, 0)
    expect(m.vitaminB12).toBeCloseTo(0.7, 1) // µg
    expect(m.sodium).toBeCloseTo(400, 0)
  })
})

describe('computeDayNutrition', () => {
  it('reports remaining for benefits and over for limits', () => {
    const logs = [log('2026-06-28', { iron: 5, alcohol: 15 }, 60)]
    const day = computeDayNutrition(logs, '2026-06-28', { proteinTarget: 150 })
    const protein = day.benefits.find((b) => b.key === 'protein')!
    expect(protein.remaining).toBe(90)
    const iron = day.benefits.find((b) => b.key === 'iron')!
    expect(iron.remaining).toBe(7) // ref 12 - 5
    const alcohol = day.limits.find((l) => l.key === 'alcohol')!
    expect(alcohol.remaining).toBeLessThan(0) // 15 > cap 10 → drüber
  })
})

describe('recommendFoods', () => {
  it('suggests foods that fill the top deficits, respecting diet and allergies', () => {
    const logs = [log('2026-06-28', {}, 0)]
    const day = computeDayNutrition(logs, '2026-06-28', { proteinTarget: 150, vegan: true })
    const recs = recommendFoods(rankDeficits(day), { vegan: true, allergies: ['nuts'] })
    expect(recs.length).toBeGreaterThan(0)
    // Keine tierischen Produkte und keine Nüsse empfehlen.
    for (const r of recs) {
      expect(r.food.vegan).toBe(true)
      expect(r.food.allergens).not.toContain('nuts')
      expect(r.food.vice).not.toBe(true)
    }
  })
})
