import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/db/types'
import { AFFINITY_DAYS, affinityStartKey, mealAffinityCounts, sortByMealAffinity } from './mealAffinity'

const log = (over: Partial<LogEntry>): Pick<LogEntry, 'foodId' | 'meal' | 'planned' | 'deletedAt'> => ({
  foodId: over.foodId ?? 'f',
  meal: over.meal ?? 'breakfast',
  planned: over.planned,
  deletedAt: over.deletedAt,
})

describe('affinityStartKey', () => {
  it('liefert den ersten Tag des 14-Tage-Fensters (inklusive heute)', () => {
    expect(AFFINITY_DAYS).toBe(14)
    // 2026-07-11 minus 13 Tage = 2026-06-28 → 28.6.–11.7. sind 14 Tage.
    expect(affinityStartKey('2026-07-11')).toBe('2026-06-28')
    // Über Monats-/Jahresgrenze.
    expect(affinityStartKey('2026-01-05')).toBe('2025-12-23')
  })
})

describe('mealAffinityCounts', () => {
  it('zählt je foodId nur die gewählte Mahlzeit; deleted/planned zählen nie', () => {
    const logs = [
      log({ foodId: 'oats' }),
      log({ foodId: 'oats' }),
      log({ foodId: 'milk' }),
      log({ foodId: 'oats', meal: 'lunch' }), // andere Mahlzeit
      log({ foodId: 'oats', deletedAt: 1 }), // gelöscht
      log({ foodId: 'oats', planned: true }), // nur geplant (Wochenplan)
    ]
    const counts = mealAffinityCounts(logs, 'breakfast')
    expect(counts.get('oats')).toBe(2)
    expect(counts.get('milk')).toBe(1)
    expect(counts.has('rice')).toBe(false)
    expect(mealAffinityCounts([], 'breakfast').size).toBe(0)
  })
})

describe('sortByMealAffinity', () => {
  const foods = [
    { id: 'rice', updatedAt: 30 },
    { id: 'oats', updatedAt: 10 },
    { id: 'milk', updatedAt: 20 },
  ]

  it('häufigste zuerst, bei Gleichstand zuletzt benutzte (updatedAt)', () => {
    const counts = new Map([
      ['oats', 3],
      ['milk', 3],
      ['rice', 1],
    ])
    expect(sortByMealAffinity(foods, counts).map((f) => f.id)).toEqual(['milk', 'oats', 'rice'])
  })

  it('ohne Treffer bleibt die updatedAt-Reihenfolge; Eingabe wird nicht mutiert', () => {
    const input = [...foods]
    expect(sortByMealAffinity(input, new Map()).map((f) => f.id)).toEqual(['rice', 'milk', 'oats'])
    expect(input).toEqual(foods) // unverändert
  })

  it('Foods mit Affinität schlagen frisch benutzte ohne Affinität', () => {
    const counts = new Map([['oats', 1]])
    expect(sortByMealAffinity(foods, counts).map((f) => f.id)).toEqual(['oats', 'rice', 'milk'])
  })
})
