import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood, setFoodPrice, setPantry } from '@/db/repo'
import type { Goal } from '@/db/types'
import { effectivePantryQty, lowPantryFoods, setPantryQty } from './pantryStock'
import { computeStats, sumsByDate } from './gamification'
import { sumCost } from './money'
import { addShoppingItem, openShoppingItems } from './shopping'
import {
  backfillFood,
  confirmPlanned,
  missingForPlan,
  missingToShoppingList,
  planFood,
  plannedForDate,
  sumPlannedCost,
} from './planning'

const base = { per: 'g' as const, kcal: 200, protein: 10, carbs: 20, fat: 4 }
const DATE = '2026-07-11'

describe('Wochenplaner (planned-Logs)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('planFood erzeugt einen planned-Log mit computed- und Kosten-Snapshot', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2, per: 500 })

    const entry = await planFood({
      food: (await db.foods.get(food.id))!,
      date: DATE,
      meal: 'dinner',
      amount: 100,
      unit: 'g',
    })
    expect(entry.planned).toBe(true)
    expect(entry.computed.kcal).toBe(200)
    expect(entry.cost).toBe(0.4)
    expect((await db.logs.get(entry.id))!.planned).toBe(true)
  })

  it('planFood persistiert den serving-Snapshot („2 Stück") wie logFood', async () => {
    const food = await createFood({ name: 'Cookies', ...base })
    const entry = await planFood({
      food,
      date: DATE,
      meal: 'snack',
      amount: 44,
      unit: 'g',
      serving: { label: 'Stück', count: 2 },
    })
    expect(entry.serving).toEqual({ label: 'Stück', count: 2 })
    expect((await db.logs.get(entry.id))!.serving).toEqual({ label: 'Stück', count: 2 })

    // Ohne Snapshot bleibt das Feld ganz weg (sync-sauber, kein Leer-Feld).
    const plain = await planFood({ food, date: DATE, meal: 'lunch', amount: 100, unit: 'g' })
    expect('serving' in (await db.logs.get(plain.id))!).toBe(false)
  })

  it('planned-Logs zählen NICHT in Verzehr-Summen (sumsByDate) und Kosten (sumCost)', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2, per: 500 })
    const stored = (await db.foods.get(food.id))!
    await planFood({ food: stored, date: DATE, meal: 'lunch', amount: 100, unit: 'g' })

    const logs = await db.logs.toArray()
    expect(sumsByDate(logs)[DATE]).toBeUndefined()
    expect(sumCost(logs)).toBe(0)
  })

  it('confirmPlanned entfernt das Flag, setzt loggedAt frisch und rechnet den Snapshot neu', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2, per: 500 })
    const entry = await planFood({
      food: (await db.foods.get(food.id))!,
      date: DATE,
      meal: 'dinner',
      amount: 100,
      unit: 'g',
    })

    // Zwischen Planung und Essen ändert sich der Preis → Kosten-Snapshot neu.
    await setFoodPrice(food.id, { amount: 4, per: 500 })
    await db.logs.update(entry.id, { loggedAt: 1 }) // alte Plan-Zeit simulieren

    const confirmed = (await confirmPlanned(entry.id))!.entry
    expect(confirmed.planned).toBeUndefined()
    expect(confirmed.cost).toBe(0.8)
    expect(confirmed.loggedAt).toBeGreaterThan(1)

    const stored = (await db.logs.get(entry.id))!
    expect('planned' in stored).toBe(false) // Feld ganz entfernt (sync-sauber)

    // Jetzt zählt der Eintrag als Verzehr.
    const logs = await db.logs.toArray()
    expect(sumsByDate(logs)[DATE]!.kcal).toBe(200)
    expect(sumCost(logs)).toBe(0.8)

    // Nur geplante Einträge sind bestätigbar.
    expect(await confirmPlanned(entry.id)).toBeUndefined()
  })

  it('confirmPlanned zieht eine Vorrats-Packung ab — wie der direkte Verzehr', async () => {
    const food = await createFood({ name: 'Nudeln', ...base })
    await setPantryQty(food.id, 1) // letzte Packung
    const entry = await planFood({ food, date: DATE, meal: 'dinner', amount: 100, unit: 'g' })

    const result = (await confirmPlanned(entry.id))!
    expect(result.pantryTook).toBe(true) // Undo legt die Packung zurück
    const stored = (await db.foods.get(food.id))!
    expect(stored).toMatchObject({ pantry: true, pantryQty: 0 }) // leer, bleibt Nachkauf-Kandidat
    expect(effectivePantryQty(stored)).toBe(0)
    expect((await lowPantryFoods()).map((f) => f.id)).toContain(food.id)

    // Ohne Vorrats-Bezug wird nichts abgezogen.
    const plain = await createFood({ name: 'Brot', ...base })
    const other = await planFood({ food: plain, date: DATE, meal: 'lunch', amount: 100, unit: 'g' })
    expect((await confirmPlanned(other.id))!.pantryTook).toBe(false)
    expect((await db.foods.get(plain.id))!.pantry).toBeUndefined()
  })

  it('plannedForDate liefert nur geplante, nicht gelöschte Einträge des Tages', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    const a = await planFood({ food, date: DATE, meal: 'lunch', amount: 100, unit: 'g' })
    const b = await planFood({ food, date: DATE, meal: 'dinner', amount: 50, unit: 'g' })
    await planFood({ food, date: '2026-07-12', meal: 'lunch', amount: 100, unit: 'g' })
    await db.logs.update(b.id, { deletedAt: Date.now() })

    const planned = await plannedForDate(DATE)
    expect(planned.map((l) => l.id)).toEqual([a.id])
  })

  it('missingForPlan: geplante Foods ohne Vorrat bzw. mit leerer Packung, ohne Duplikate', async () => {
    const inStock = await createFood({ name: 'Reis', ...base })
    const emptyPack = await createFood({ name: 'Linsen', ...base })
    const noPantry = await createFood({ name: 'Kokosmilch', ...base })
    await setPantry(inStock.id, true)
    await setPantryQty(emptyPack.id, 0)

    await planFood({ food: inStock, date: DATE, meal: 'dinner', amount: 100, unit: 'g' })
    await planFood({ food: emptyPack, date: DATE, meal: 'dinner', amount: 100, unit: 'g' })
    await planFood({ food: noPantry, date: DATE, meal: 'dinner', amount: 100, unit: 'g' })
    // Doppelt geplant → trotzdem nur ein Kandidat.
    await planFood({ food: noPantry, date: DATE, meal: 'lunch', amount: 50, unit: 'g' })

    const missing = await missingForPlan(DATE)
    expect(missing.map((f) => f.name).sort()).toEqual(['Kokosmilch', 'Linsen'])
  })

  it('missingToShoppingList legt plan-Einträge an und überspringt bereits gelistete Foods', async () => {
    const lentils = await createFood({ name: 'Linsen', ...base })
    const coconut = await createFood({ name: 'Kokosmilch', ...base })
    await planFood({ food: lentils, date: DATE, meal: 'dinner', amount: 100, unit: 'g' })
    await planFood({ food: coconut, date: DATE, meal: 'dinner', amount: 100, unit: 'g' })
    // Kokosmilch steht schon offen auf der Liste → kein Duplikat.
    await addShoppingItem({ name: 'Kokosmilch', foodId: coconut.id })

    const created = await missingToShoppingList(DATE)
    expect(created.map((i) => i.name)).toEqual(['Linsen'])
    expect(created[0].source).toBe('plan')
    expect(created[0].foodId).toBe(lentils.id)

    const open = await openShoppingItems()
    expect(open).toHaveLength(2)

    // Zweiter Aufruf ist idempotent — alles schon gelistet.
    expect(await missingToShoppingList(DATE)).toEqual([])
  })

  it('backfillFood erzeugt einen echten Log (kein planned) für den Vortag', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    const yesterday = '2026-07-10'

    const { entry, pantryTook } = await backfillFood({
      food,
      date: yesterday,
      meal: 'dinner',
      amount: 100,
      unit: 'g',
    })
    expect(pantryTook).toBe(false) // Reis liegt nicht im Vorrat

    const stored = (await db.logs.get(entry.id))!
    expect(stored.date).toBe(yesterday)
    expect('planned' in stored).toBe(false) // Nachtrag ist gegessen, kein Plan
    expect(sumsByDate([stored])[yesterday]!.kcal).toBe(200) // zählt sofort als Verzehr
  })

  it('nachgetragener Vortag zählt in der Streak wie normal Geloggtes', async () => {
    const minGoal = (nutrient: string, target: number): Goal => ({
      id: `g-${nutrient}`,
      nutrient,
      type: 'min',
      target,
      unit: 'g',
      active: true,
      createdBy: 'user',
      updatedAt: 0,
    })
    const goals = { kcal: minGoal('kcal', 100), protein: minGoal('protein', 5) }

    const food = await createFood({ name: 'Reis', ...base })
    // Heute normal geloggt, der vergessene Vortag nachgetragen.
    await backfillFood({ food, date: DATE, meal: 'lunch', amount: 100, unit: 'g' })
    await backfillFood({ food, date: '2026-07-10', meal: 'dinner', amount: 100, unit: 'g' })

    const stats = computeStats(await db.logs.toArray(), goals, DATE)
    expect(stats.overallStreak).toBe(2) // Nachtrag schließt die Lücke
    expect(stats.distinctDays).toBe(2)
  })

  it('backfillFood zieht wie confirmPlanned eine Vorrats-Packung ab', async () => {
    const food = await createFood({ name: 'Nudeln', ...base })
    await setPantryQty(food.id, 2)

    const { pantryTook } = await backfillFood({
      food,
      date: '2026-07-10',
      meal: 'dinner',
      amount: 100,
      unit: 'g',
    })
    expect(pantryTook).toBe(true) // Undo legt die Packung zurück
    expect(effectivePantryQty((await db.foods.get(food.id))!)).toBe(1)
  })

  it('sumPlannedCost summiert nur geplante, nicht gelöschte Kosten-Snapshots', () => {
    expect(
      sumPlannedCost([
        { cost: 0.4, planned: true },
        { cost: 0.2, planned: true, deletedAt: 1 }, // gelöscht → zählt nicht
        { cost: 9 }, // echter Verzehr → zählt nicht
        { planned: true }, // ohne Preis
      ]),
    ).toBe(0.4)
  })
})
