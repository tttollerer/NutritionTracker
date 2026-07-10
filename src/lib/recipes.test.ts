import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood, setFoodPrice } from '@/db/repo'
import { createRecipe, deleteRecipe, listRecipes, logRecipe, recipeCostPerPortion, updateRecipe } from './recipes'

const base = { per: 'g' as const, carbs: 20, fat: 4 }

describe('Rezepte', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('createRecipe/updateRecipe/deleteRecipe (Tombstone) + listRecipes', async () => {
    const rice = await createFood({ name: 'Reis', ...base, kcal: 350, protein: 7 })
    const curry = await createRecipe({
      name: '  Linsen-Curry ',
      portions: 4,
      ingredients: [{ foodId: rice.id, amount: 300, unit: 'g' }],
    })
    expect(curry.name).toBe('Linsen-Curry')

    await updateRecipe(curry.id, { portions: 2 })
    expect((await db.recipes.get(curry.id))!.portions).toBe(2)

    const other = await createRecipe({ name: 'Bowl', portions: 1, ingredients: [] })
    await deleteRecipe(other.id)
    expect((await db.recipes.get(other.id))!.deletedAt).toBeGreaterThan(0)
    expect((await listRecipes()).map((r) => r.name)).toEqual(['Linsen-Curry'])
    // Gelöschte Rezepte sind nicht mehr loggbar/änderbar.
    expect(await updateRecipe(other.id, { name: 'X' })).toBeUndefined()
    expect(await logRecipe(other.id, { date: '2026-07-10', meal: 'lunch', portionsEaten: 1 })).toEqual([])
  })

  it('logRecipe skaliert Zutaten auf gegessene Portionen — ein LogEntry je Zutat inkl. cost', async () => {
    const rice = await createFood({ name: 'Reis', ...base, kcal: 350, protein: 7 })
    const lentils = await createFood({ name: 'Linsen', ...base, kcal: 300, protein: 25 })
    await setFoodPrice(rice.id, { amount: 2, per: 500 })
    // Linsen bleiben ohne Preis → Eintrag ohne cost-Feld.

    const recipe = await createRecipe({
      name: 'Linsen-Curry',
      portions: 4,
      ingredients: [
        { foodId: rice.id, amount: 400, unit: 'g' },
        { foodId: lentils.id, amount: 200, unit: 'g' },
      ],
    })

    // 2 von 4 Portionen → Faktor 0,5.
    const entries = await logRecipe(recipe.id, { date: '2026-07-10', meal: 'dinner', portionsEaten: 2 })
    expect(entries).toHaveLength(2)
    expect(await db.logs.count()).toBe(2)

    const riceEntry = entries.find((e) => e.foodId === rice.id)!
    expect(riceEntry).toMatchObject({ amount: 200, unit: 'g', meal: 'dinner', date: '2026-07-10' })
    expect(riceEntry.computed.kcal).toBe(700) // 200 g à 350 kcal/100 g
    expect(riceEntry.cost).toBe(0.8) // 200/500 * 2 €
    expect(riceEntry.planned).toBeUndefined() // geloggt = gegessen, nicht geplant

    const lentilEntry = entries.find((e) => e.foodId === lentils.id)!
    expect(lentilEntry.amount).toBe(100)
    expect(lentilEntry.computed.protein).toBe(25)
    expect('cost' in (await db.logs.get(lentilEntry.id))!).toBe(false)
  })

  it('logRecipe überspringt gelöschte Zutaten-Foods statt zu scheitern', async () => {
    const rice = await createFood({ name: 'Reis', ...base, kcal: 350, protein: 7 })
    const gone = await createFood({ name: 'Weg', ...base, kcal: 100, protein: 1 })
    await db.foods.update(gone.id, { deletedAt: Date.now() })

    const recipe = await createRecipe({
      name: 'Rest-Curry',
      portions: 2,
      ingredients: [
        { foodId: rice.id, amount: 200, unit: 'g' },
        { foodId: gone.id, amount: 100, unit: 'g' },
      ],
    })
    const entries = await logRecipe(recipe.id, { date: '2026-07-10', meal: 'lunch', portionsEaten: 2 })
    expect(entries).toHaveLength(1)
    expect(entries[0].foodId).toBe(rice.id)
    expect(entries[0].amount).toBe(200)
  })

  it('recipeCostPerPortion summiert bepreiste Zutaten je Portion; ohne Preise undefined', async () => {
    const rice = await createFood({ name: 'Reis', ...base, kcal: 350, protein: 7 })
    const lentils = await createFood({ name: 'Linsen', ...base, kcal: 300, protein: 25 })
    await setFoodPrice(rice.id, { amount: 2, per: 500 })
    await setFoodPrice(lentils.id, { amount: 3, per: 300 })
    const foodsMap = new Map((await db.foods.toArray()).map((f) => [f.id, f]))

    const recipe = {
      portions: 4,
      ingredients: [
        { foodId: rice.id, amount: 400, unit: 'g' as const },
        { foodId: lentils.id, amount: 200, unit: 'g' as const },
      ],
    }
    // Reis 400/500*2 = 1,60 € + Linsen 200/300*3 = 2 € → 3,60 € / 4 = 0,90 €.
    expect(recipeCostPerPortion(recipe, foodsMap)).toBe(0.9)

    const unpriced = await createFood({ name: 'Wasser', per: 'ml', kcal: 0, protein: 0, carbs: 0, fat: 0 })
    const free = { portions: 2, ingredients: [{ foodId: unpriced.id, amount: 500, unit: 'ml' as const }] }
    const map2 = new Map((await db.foods.toArray()).map((f) => [f.id, f]))
    expect(recipeCostPerPortion(free, map2)).toBeUndefined()
  })
})
