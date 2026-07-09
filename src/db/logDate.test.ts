import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import { copyYesterday, createFood, logFood, setLogDate } from './repo'
import { computeStats } from '@/lib/gamification'
import type { Goal } from '@/db/types'
import { todayKey } from '@/lib/utils'
import { shiftDayKey } from '@/lib/dayContext'

async function seedFood() {
  return createFood({ name: 'Haferflocken', per: 'g', kcal: 370, protein: 13, carbs: 59, fat: 7 })
}

describe('logFood mit Zieldatum (Nachtragen)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('loggt ohne date-Parameter auf heute (abwärtskompatibel)', async () => {
    const food = await seedFood()
    const entry = await logFood({ food, meal: 'breakfast', amount: 100, unit: 'g' })
    expect(entry.date).toBe(todayKey())
  })

  it('loggt mit date auf den Zieltag — loggedAt bleibt der Jetzt-Zeitpunkt', async () => {
    const food = await seedFood()
    const before = Date.now()
    const entry = await logFood({ food, date: '2026-07-03', meal: 'dinner', amount: 50, unit: 'g' })
    expect(entry.date).toBe('2026-07-03')
    expect(entry.loggedAt).toBeGreaterThanOrEqual(before)
    expect((await db.logs.get(entry.id))!.date).toBe('2026-07-03')
  })

  it('setLogDate verschiebt einen Eintrag auf einen anderen Tag (PortionSheet-Nachtrag)', async () => {
    const food = await seedFood()
    const entry = await logFood({ food, meal: 'lunch', amount: 100, unit: 'g' })
    await setLogDate(entry.id, '2026-07-01')
    const moved = (await db.logs.get(entry.id))!
    expect(moved.date).toBe('2026-07-01')
    expect(moved.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt)
  })
})

describe('copyYesterday relativ zum Zieltag', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('kopiert beim Nachtragen den Vortag DES ZIELTAGS auf den Zieltag', async () => {
    const food = await seedFood()
    // Vortag des Zieltags (02.07.) und ein Ablenker am realen Gestern.
    await logFood({ food, date: '2026-07-02', meal: 'breakfast', amount: 100, unit: 'g' })
    await logFood({ food, date: shiftDayKey(todayKey(), -1), meal: 'breakfast', amount: 40, unit: 'g' })

    const copies = await copyYesterday(undefined, '2026-07-03')

    expect(copies).toHaveLength(1)
    expect(copies[0].date).toBe('2026-07-03')
    expect(copies[0].amount).toBe(100)
    expect((await db.logs.where('date').equals('2026-07-03').count())).toBe(1)
  })

  it('kopiert ohne Zieltag weiterhin gestern → heute', async () => {
    const food = await seedFood()
    await logFood({ food, date: shiftDayKey(todayKey(), -1), meal: 'snack', amount: 30, unit: 'g' })
    const copies = await copyYesterday()
    expect(copies).toHaveLength(1)
    expect(copies[0].date).toBe(todayKey())
  })
})

describe('Streak: nachgetragene Tage zählen mit (alles rechnet aus logs.date)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  const goals: Record<string, Goal> = {
    kcal: { id: 'g1', nutrient: 'kcal', type: 'min', target: 100, unit: 'kcal', active: true, createdBy: 'user', updatedAt: 0 },
    protein: { id: 'g2', nutrient: 'protein', type: 'min', target: 5, unit: 'g', active: true, createdBy: 'user', updatedAt: 0 },
  }

  it('Log auf den Vortag verlängert die Streak von 1 auf 2', async () => {
    const food = await seedFood()
    const today = todayKey()

    await logFood({ food, meal: 'breakfast', amount: 100, unit: 'g' }) // heute
    let stats = computeStats(await db.logs.toArray(), goals, today)
    expect(stats.overallStreak).toBe(1)

    // Vergessenen Vortag über den Kalender nachtragen:
    await logFood({ food, date: shiftDayKey(today, -1), meal: 'dinner', amount: 100, unit: 'g' })
    stats = computeStats(await db.logs.toArray(), goals, today)
    expect(stats.overallStreak).toBe(2)
  })
})
