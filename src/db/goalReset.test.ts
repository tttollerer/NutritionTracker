import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import {
  applyChallengeSuggestion,
  applyGoalSuggestion,
  resetGoalToBase,
  saveOnboarding,
  setGoalActive,
} from './repo'
import { computeTargets } from '@/lib/nutrition'
import { evaluateChallenge } from '@/lib/challenges'
import type { Profile } from './types'

const baseProfile: Omit<Profile, 'id' | 'updatedAt'> = {
  sex: 'm',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'medium',
  goal: 'maintain',
  persona: 'general',
  dietForms: [],
}

describe('resetGoalToBase (Befund 3: Coach-Ziele sind keine Einbahnstraße)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await saveOnboarding(baseProfile, [])
  })

  it('setzt ein Coach-angepasstes Basis-Ziel auf den Profil-Basiswert zurück', async () => {
    await applyGoalSuggestion({ nutrient: 'kcal', type: 'max', target: 2000, unit: 'kcal' })

    await resetGoalToBase('kcal')

    const active = await db.goals.filter((g) => g.nutrient === 'kcal' && !g.deletedAt && g.active).toArray()
    expect(active).toHaveLength(1)
    const profile = (await db.profile.get('me'))!
    expect(active[0]).toMatchObject({
      createdBy: 'user',
      target: computeTargets(profile).kcal,
    })
  })

  it('entfernt ein reines Coach-Ziel (z. B. sugar) ersatzlos', async () => {
    await applyGoalSuggestion({ nutrient: 'sugar', type: 'max', target: 30, unit: 'g' })

    await resetGoalToBase('sugar')

    const remaining = await db.goals.filter((g) => g.nutrient === 'sugar' && !g.deletedAt).toArray()
    expect(remaining).toHaveLength(0)
  })

  it('nach Reset greift updateProfile wieder (createdBy ist nicht mehr coach)', async () => {
    await applyGoalSuggestion({ nutrient: 'kcal', type: 'max', target: 2000, unit: 'kcal' })
    await resetGoalToBase('kcal')

    const kcal = (await db.goals.filter((g) => g.nutrient === 'kcal' && !g.deletedAt).toArray())[0]
    expect(kcal.createdBy).toBe('user')
  })
})

describe('setGoalActive (Befund 3: Ziele deaktivierbar)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await saveOnboarding(baseProfile, [])
  })

  it('deaktiviert und reaktiviert ein Ziel', async () => {
    await setGoalActive('base-carbs', false)
    expect((await db.goals.get('base-carbs'))!.active).toBe(false)

    await setGoalActive('base-carbs', true)
    expect((await db.goals.get('base-carbs'))!.active).toBe(true)
  })
})

describe('applyChallengeSuggestion mit rule (Vertrag v1.2)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('persistiert die rule und macht die Challenge automatisch auswertbar', async () => {
    await applyChallengeSuggestion({
      title: 'Max. 30 g Zucker heute',
      period: 'day',
      rule: { nutrient: 'sugar', type: 'max', target: 30, unit: 'g' },
    })

    const [c] = await db.challenges.toArray()
    expect(c).toMatchObject({ status: 'active', createdBy: 'coach' })
    expect(c.rule).toEqual({ nutrient: 'sugar', type: 'max', target: 30, unit: 'g' })

    // sugar-Summe kommt aus den getrackten micros (sumsByDate) → auswertbar.
    const progress = evaluateChallenge(
      c,
      { '2026-07-09': { kcal: 900, protein: 40, carbs: 90, fat: 30, sugar: 12 } },
      '2026-07-09',
    )
    expect(progress).toMatchObject({ kind: 'day', current: 12, target: 30, met: true })
  })

  it('ohne rule bleibt die Challenge manuell (rule {} → progress null)', async () => {
    await applyChallengeSuggestion({ title: 'Mehr Gemüse', period: 'week' })
    const [c] = await db.challenges.toArray()
    expect(c.rule).toEqual({})
    expect(evaluateChallenge(c, {}, '2026-07-09')).toBeNull()
  })
})
