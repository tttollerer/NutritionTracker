import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import {
  copyYesterday,
  createFood,
  deleteLog,
  favoriteFoods,
  foodNameMatches,
  logFood,
  searchFoods,
  toggleFavorite,
  yesterdayMealSummary,
} from './repo'
import { todayKey } from '@/lib/utils'

/** Lokaler Tages-Schlüssel n Tage vor heute (gleiche Logik wie die App: setDate). */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return todayKey(d)
}

async function seedFood(name = 'Haferflocken') {
  return createFood({ name, per: 'g', kcal: 370, protein: 13, carbs: 59, fat: 7 })
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('copyYesterday', () => {
  it('kopiert alle gestrigen Logs auf heute: neue IDs, heutiges Datum, frisches loggedAt', async () => {
    const food = await seedFood()
    const a = await logFood({ food, date: daysAgo(1), meal: 'breakfast', amount: 60, unit: 'g' })
    const b = await logFood({ food, date: daysAgo(1), meal: 'lunch', amount: 100, unit: 'g' })
    // Störfaktoren: vorgestern + soft-deleted gestern → dürfen nicht mitkopiert werden.
    await logFood({ food, date: daysAgo(2), meal: 'dinner', amount: 50, unit: 'g' })
    const del = await logFood({ food, date: daysAgo(1), meal: 'snack', amount: 30, unit: 'g' })
    await deleteLog(del.id)

    const before = Date.now()
    const copies = await copyYesterday()

    expect(copies).toHaveLength(2)
    const sourceIds = new Set([a.id, b.id])
    for (const c of copies) {
      expect(sourceIds.has(c.id)).toBe(false)
      expect(c.date).toBe(todayKey())
      expect(c.loggedAt).toBeGreaterThanOrEqual(before)
    }
    expect(copies.map((c) => c.meal).sort()).toEqual(['breakfast', 'lunch'])
    // Persistiert:
    const todays = await db.logs.where('date').equals(todayKey()).toArray()
    expect(todays).toHaveLength(2)
  })

  it('übernimmt den computed-Snapshot, statt neu zu berechnen', async () => {
    const food = await seedFood()
    const src = await logFood({ food, date: daysAgo(1), meal: 'dinner', amount: 100, unit: 'g' })
    // Lebensmittel ändert sich nachträglich — die Kopie muss das Gestern abbilden.
    await db.foods.update(food.id, { kcal: 999 })

    const [copy] = await copyYesterday()
    expect(copy.computed).toEqual(src.computed)
    expect(copy.computed.kcal).toBe(370)
    expect(copy.amount).toBe(100)
    expect(copy.unit).toBe('g')
    expect(copy.foodId).toBe(food.id)
  })

  it('übernimmt Kosten- und Portions-Snapshot (Haushaltskasse zählt kopierte Tage)', async () => {
    const food = await seedFood()
    const src = await logFood({ food, date: daysAgo(1), meal: 'lunch', amount: 60, unit: 'g' })
    await db.logs.update(src.id, { cost: 1.23, serving: { label: 'Kappe (30 g)', count: 2 } })

    const [copy] = await copyYesterday()
    expect(copy.cost).toBe(1.23)
    expect(copy.serving).toEqual({ label: 'Kappe (30 g)', count: 2 })
  })

  it('kopiert auf Wunsch nur eine Mahlzeit', async () => {
    const food = await seedFood()
    await logFood({ food, date: daysAgo(1), meal: 'breakfast', amount: 60, unit: 'g' })
    await logFood({ food, date: daysAgo(1), meal: 'lunch', amount: 100, unit: 'g' })

    const copies = await copyYesterday('lunch')
    expect(copies).toHaveLength(1)
    expect(copies[0].meal).toBe('lunch')
  })

  it('gibt bei leerem Gestern ein leeres Array zurück', async () => {
    expect(await copyYesterday()).toEqual([])
  })
})

describe('yesterdayMealSummary', () => {
  it('zählt Anzahl + kcal nur der gewählten Mahlzeit; deleted/planned zählen nicht', async () => {
    const food = await seedFood() // 370 kcal / 100 g
    await logFood({ food, date: daysAgo(1), meal: 'breakfast', amount: 100, unit: 'g' }) // 370
    await logFood({ food, date: daysAgo(1), meal: 'breakfast', amount: 50, unit: 'g' }) // 185
    await logFood({ food, date: daysAgo(1), meal: 'lunch', amount: 100, unit: 'g' }) // andere Mahlzeit
    await logFood({ food, date: daysAgo(2), meal: 'breakfast', amount: 100, unit: 'g' }) // vorgestern
    const del = await logFood({ food, date: daysAgo(1), meal: 'breakfast', amount: 100, unit: 'g' })
    await deleteLog(del.id)
    const planned = await logFood({ food, date: daysAgo(1), meal: 'breakfast', amount: 100, unit: 'g' })
    await db.logs.update(planned.id, { planned: true })

    expect(await yesterdayMealSummary('breakfast')).toEqual({ count: 2, kcal: 555 })
    expect(await yesterdayMealSummary('dinner')).toEqual({ count: 0, kcal: 0 })
  })
})

describe('toggleFavorite', () => {
  it('schaltet den Stern um und entfernt das Feld beim Abwählen (sync-sauber)', async () => {
    const food = await seedFood()

    expect(await toggleFavorite(food.id)).toBe(true)
    let stored = await db.foods.get(food.id)
    expect(stored!.favorite).toBe(true)
    expect(await favoriteFoods()).toHaveLength(1)

    expect(await toggleFavorite(food.id)).toBe(false)
    stored = await db.foods.get(food.id)
    expect('favorite' in stored!).toBe(false)
    expect(await favoriteFoods()).toHaveLength(0)
  })

  it('ignoriert unbekannte oder gelöschte Lebensmittel', async () => {
    expect(await toggleFavorite('gibt-es-nicht')).toBe(false)
    const food = await seedFood()
    await db.foods.update(food.id, { deletedAt: Date.now() })
    expect(await toggleFavorite(food.id)).toBe(false)
  })
})

describe('Katalog-Suche', () => {
  it('foodNameMatches: case-insensitives „enthält", getrimmt, leere Suche matcht nie', () => {
    expect(foodNameMatches('Haferflocken', 'hafer')).toBe(true)
    expect(foodNameMatches('Haferflocken', 'FLOCKEN')).toBe(true)
    expect(foodNameMatches('Haferflocken', '  hafer  ')).toBe(true)
    expect(foodNameMatches('Haferflocken', 'reis')).toBe(false)
    expect(foodNameMatches('Haferflocken', '')).toBe(false)
    expect(foodNameMatches('Haferflocken', '   ')).toBe(false)
  })

  it('searchFoods: ohne Soft-Deleted, Favoriten zuerst, Limit greift', async () => {
    const oat = await seedFood('Haferflocken')
    const milk = await createFood({ name: 'Hafermilch', per: 'ml', kcal: 46, protein: 1, carbs: 8, fat: 1.5 })
    const gone = await createFood({ name: 'Haferkekse', per: 'g', kcal: 450, protein: 7, carbs: 60, fat: 20 })
    await db.foods.update(gone.id, { deletedAt: Date.now() })
    await toggleFavorite(milk.id)

    const hits = await searchFoods('hafer')
    expect(hits.map((f) => f.id)).toEqual([milk.id, oat.id])

    expect(await searchFoods('hafer', 1)).toHaveLength(1)
    expect(await searchFoods('   ')).toEqual([])
  })
})
