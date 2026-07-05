import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import type { Challenge } from '@/db/types'
import {
  evaluateChallenge,
  markChallengeDone,
  markChallengeFailed,
  parseChallengeRule,
} from './challenges'

const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  id: 'c1',
  title: 'Heute 150 g Eiweiß',
  rule: { nutrient: 'protein', type: 'min', target: 150, unit: 'g' },
  period: 'day',
  status: 'active',
  createdBy: 'coach',
  updatedAt: 1,
  ...over,
})

const sums = (protein: number) => ({
  '2026-07-05': { kcal: 2000, protein, carbs: 200, fat: 60 },
})

describe('parseChallengeRule', () => {
  it('akzeptiert eine Goal-artige Regel', () => {
    expect(parseChallengeRule({ nutrient: 'protein', type: 'min', target: 150 })).toEqual({
      nutrient: 'protein',
      type: 'min',
      target: 150,
      targetMax: undefined,
      unit: undefined,
      days: undefined,
    })
  })

  it('lehnt leeres rule ab (manuelle Challenge)', () => {
    expect(parseChallengeRule({})).toBeNull()
    expect(parseChallengeRule(null)).toBeNull()
    expect(parseChallengeRule({ nutrient: 'vitaminC', type: 'min', target: 100 })).toBeNull()
    expect(parseChallengeRule({ nutrient: 'protein', type: 'min', target: 0 })).toBeNull()
  })
})

describe('evaluateChallenge', () => {
  it('min/day erfüllt', () => {
    const p = evaluateChallenge(challenge(), sums(160), '2026-07-05')
    expect(p).not.toBeNull()
    expect(p!.met).toBe(true)
    expect(p!.current).toBe(160)
    expect(p!.target).toBe(150)
    expect(p!.pct).toBe(1)
  })

  it('min/day nicht erfüllt', () => {
    const p = evaluateChallenge(challenge(), sums(75), '2026-07-05')
    expect(p!.met).toBe(false)
    expect(p!.pct).toBeCloseTo(0.5)
  })

  it('Tag ohne Logs zählt als 0', () => {
    const p = evaluateChallenge(challenge(), {}, '2026-07-05')
    expect(p!.met).toBe(false)
    expect(p!.current).toBe(0)
  })

  it('leeres rule → null (manuell abschließbar)', () => {
    expect(evaluateChallenge(challenge({ rule: {} }), sums(160), '2026-07-05')).toBeNull()
  })

  it('week: zählt erfüllte Tage gegen die geforderte Anzahl', () => {
    const c = challenge({ period: 'week', rule: { nutrient: 'protein', type: 'min', target: 150, days: 2 } })
    const weekSums = {
      '2026-07-04': { kcal: 0, protein: 155, carbs: 0, fat: 0 },
      '2026-07-05': { kcal: 0, protein: 160, carbs: 0, fat: 0 },
    }
    const p = evaluateChallenge(c, weekSums, '2026-07-05')
    expect(p!.kind).toBe('week')
    expect(p!.current).toBe(2)
    expect(p!.target).toBe(2)
    expect(p!.met).toBe(true)
  })
})

describe('markChallengeDone / markChallengeFailed', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('setzt Status done und aktualisiert updatedAt', async () => {
    await db.challenges.put(challenge())
    const before = Date.now()
    await markChallengeDone('c1')
    const c = await db.challenges.get('c1')
    expect(c!.status).toBe('done')
    expect(c!.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('setzt Status failed und aktualisiert updatedAt', async () => {
    await db.challenges.put(challenge({ id: 'c2' }))
    const before = Date.now()
    await markChallengeFailed('c2')
    const c = await db.challenges.get('c2')
    expect(c!.status).toBe('failed')
    expect(c!.updatedAt).toBeGreaterThanOrEqual(before)
  })
})
