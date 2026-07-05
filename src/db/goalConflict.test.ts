import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import { applyGoalSuggestion, saveOnboarding, updateProfile } from './repo'
import { computeTargets } from '@/lib/nutrition'
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

describe('updateProfile vs. Coach-Ziele', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await saveOnboarding(baseProfile, [])
  })

  it('Coach-Anpassung eines Basis-Ziels überlebt updateProfile', async () => {
    // Coach passt das kcal-Ziel an (editiert das Basis-Ziel in-place, createdBy → coach).
    await applyGoalSuggestion({ nutrient: 'kcal', type: 'max', target: 2600, unit: 'kcal' })

    await updateProfile({ weightKg: 90 })

    const kcal = await db.goals.filter((g) => g.nutrient === 'kcal' && !g.deletedAt).toArray()
    expect(kcal).toHaveLength(1)
    expect(kcal[0]).toMatchObject({ target: 2600, type: 'max', createdBy: 'coach' })
  })

  it('nicht angepasste Basis-Ziele werden weiterhin neu berechnet', async () => {
    await applyGoalSuggestion({ nutrient: 'kcal', type: 'max', target: 2600, unit: 'kcal' })

    const result = await updateProfile({ weightKg: 90 })

    const protein = await db.goals.get('base-protein')
    expect(protein!.target).toBe(computeTargets(result!.profile).protein)
    expect(protein!.createdBy).toBe('user')
  })

  it('Coach-Ziel mit eigener ID erzeugt kein doppeltes aktives Basis-Ziel', async () => {
    // Basis-Ziel für kcal entfernen und ein reines Coach-Ziel anlegen …
    await db.goals.update('base-kcal', { deletedAt: Date.now() })
    await applyGoalSuggestion({ nutrient: 'kcal', type: 'max', target: 2400, unit: 'kcal' })

    await updateProfile({ weightKg: 90 })

    // … updateProfile darf das gelöschte base-kcal nicht wiederbeleben.
    const active = await db.goals.filter((g) => g.nutrient === 'kcal' && !g.deletedAt && g.active).toArray()
    expect(active).toHaveLength(1)
    expect(active[0].target).toBe(2400)
  })
})
