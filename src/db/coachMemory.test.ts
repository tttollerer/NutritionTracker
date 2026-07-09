import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import { dietFromForms, saveOnboarding, setCoachTone, updateProfile } from './repo'
import type { Profile } from './types'

const baseProfile: Omit<Profile, 'id' | 'updatedAt'> = {
  sex: 'f',
  age: 28,
  heightCm: 168,
  weightKg: 62,
  activity: 'medium',
  goal: 'maintain',
  persona: 'general',
  dietForms: ['vegan', 'glutenfree'],
}

describe('dietFromForms', () => {
  it('leitet eine einzelne Form als String ab', () => {
    expect(dietFromForms(['vegan'])).toBe('vegan')
  })

  it('kombiniert mehrere Formen', () => {
    expect(dietFromForms(['vegan', 'glutenfree'])).toBe('vegan+glutenfree')
  })

  it('liefert undefined ohne Formen (kein Leerstring)', () => {
    expect(dietFromForms([])).toBeUndefined()
    expect(dietFromForms(undefined)).toBeUndefined()
    expect(dietFromForms(['  '])).toBeUndefined()
  })
})

describe('CoachMemory-Pflege (Paket 11)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('saveOnboarding schreibt diet aus profile.dietForms', async () => {
    await saveOnboarding(baseProfile, ['peanuts'])
    const mem = await db.coachMemory.get('me')
    expect(mem?.diet).toBe('vegan+glutenfree')
    expect(mem?.allergies).toEqual(['peanuts'])
    expect(mem?.tone).toBe('motivating')
  })

  it('updateProfile hält diet mit geänderten dietForms synchron', async () => {
    await saveOnboarding(baseProfile, [])
    await updateProfile({ dietForms: ['keto'] })
    expect((await db.coachMemory.get('me'))?.diet).toBe('keto')

    await updateProfile({ dietForms: [] })
    expect((await db.coachMemory.get('me'))?.diet).toBeUndefined()
  })

  it('updateProfile ohne dietForms-Patch lässt die Memory unangetastet', async () => {
    await saveOnboarding(baseProfile, [])
    const before = await db.coachMemory.get('me')
    await updateProfile({ weightKg: 64 })
    expect((await db.coachMemory.get('me'))?.diet).toBe(before?.diet)
  })

  it('setCoachTone persistiert die Ton-Auswahl und erhält übrige Felder', async () => {
    await saveOnboarding(baseProfile, ['soy'])
    await setCoachTone('strict')
    const mem = await db.coachMemory.get('me')
    expect(mem?.tone).toBe('strict')
    expect(mem?.diet).toBe('vegan+glutenfree')
    expect(mem?.allergies).toEqual(['soy'])
  })

  it('setCoachTone legt fehlende Memory mit Defaults an', async () => {
    await setCoachTone('casual')
    const mem = await db.coachMemory.get('me')
    expect(mem).toMatchObject({ id: 'me', tone: 'casual', allergies: [], likes: [], dislikes: [] })
  })

  it('erneutes Onboarding setzt einen gewählten Ton nicht zurück', async () => {
    await saveOnboarding(baseProfile, [])
    await setCoachTone('strict')
    await saveOnboarding({ ...baseProfile, dietForms: ['vegetarian'] }, [])
    const mem = await db.coachMemory.get('me')
    expect(mem?.tone).toBe('strict')
    expect(mem?.diet).toBe('vegetarian')
  })
})
