import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood, setFoodPrice, setPantry } from '@/db/repo'
import { setPantryQty } from './pantryStock'
import { sumsByDate } from './gamification'
import { sumCost } from './money'
import { confirmPlanned, missingForPlan, planFood, plannedForDate } from './planning'

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

    const confirmed = await confirmPlanned(entry.id)
    expect(confirmed!.planned).toBeUndefined()
    expect(confirmed!.cost).toBe(0.8)
    expect(confirmed!.loggedAt).toBeGreaterThan(1)

    const stored = (await db.logs.get(entry.id))!
    expect('planned' in stored).toBe(false) // Feld ganz entfernt (sync-sauber)

    // Jetzt zählt der Eintrag als Verzehr.
    const logs = await db.logs.toArray()
    expect(sumsByDate(logs)[DATE]!.kcal).toBe(200)
    expect(sumCost(logs)).toBe(0.8)

    // Nur geplante Einträge sind bestätigbar.
    expect(await confirmPlanned(entry.id)).toBeUndefined()
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
})
