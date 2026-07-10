import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood, setPantry } from '@/db/repo'
import { setPantryQty } from './pantryStock'
import {
  addShoppingItem,
  checkOffToPantry,
  openShoppingItems,
  removeShoppingItem,
  suggestFromLowPantry,
  toggleShoppingItem,
} from './shopping'

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }

describe('Einkaufsliste', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('addShoppingItem legt offene manuelle Einträge an; openShoppingItems filtert', async () => {
    const a = await addShoppingItem({ name: '  Milch ' })
    await addShoppingItem({ name: 'Brot', qty: 2, note: 'Vollkorn' })
    expect(a).toMatchObject({ name: 'Milch', source: 'manual', checked: false })

    // Abgehakte und gelöschte Einträge sind nicht mehr offen.
    const done = await addShoppingItem({ name: 'Butter' })
    await toggleShoppingItem(done.id)
    const gone = await addShoppingItem({ name: 'Eier' })
    await removeShoppingItem(gone.id)

    const open = await openShoppingItems()
    expect(open.map((i) => i.name).sort()).toEqual(['Brot', 'Milch'])
    // Tombstone statt Hard-Delete (sync-sauber).
    expect((await db.shoppingList.get(gone.id))!.deletedAt).toBeGreaterThan(0)
  })

  it('toggleShoppingItem schaltet um und gibt den neuen Zustand zurück', async () => {
    const item = await addShoppingItem({ name: 'Milch' })
    expect(await toggleShoppingItem(item.id)).toBe(true)
    expect(await toggleShoppingItem(item.id)).toBe(false)
    expect((await db.shoppingList.get(item.id))!.checked).toBe(false)
  })

  it('Roundtrip: suggestFromLowPantry → checkOffToPantry → pantryQty+1', async () => {
    const low = await createFood({ name: 'Haferflocken', ...base })
    await setPantryQty(low.id, 0) // leer → Nachkauf-Kandidat

    const suggested = await suggestFromLowPantry()
    expect(suggested).toHaveLength(1)
    expect(suggested[0]).toMatchObject({ name: 'Haferflocken', foodId: low.id, source: 'auto', checked: false })

    await checkOffToPantry(suggested[0].id)
    expect((await db.shoppingList.get(suggested[0].id))!.checked).toBe(true)
    expect((await db.foods.get(low.id))!.pantryQty).toBe(1)
    expect((await openShoppingItems()).length).toBe(0)
  })

  it('suggestFromLowPantry erzeugt keine Duplikate auf offene Einträge', async () => {
    const low = await createFood({ name: 'Milch', ...base })
    await setPantry(low.id, true) // qty undefined == 1 → zur Neige

    const first = await suggestFromLowPantry()
    expect(first).toHaveLength(1)
    // Zweiter Lauf: Food steht schon offen auf der Liste → nichts Neues.
    expect(await suggestFromLowPantry()).toHaveLength(0)
    expect((await openShoppingItems()).length).toBe(1)

    // Nach dem Abhaken ist der Eintrag nicht mehr offen — aber der Vorrat ist
    // wieder gefüllt (qty 2), also auch kein Nachkauf-Kandidat mehr.
    await checkOffToPantry(first[0].id)
    expect((await db.foods.get(low.id))!.pantryQty).toBe(2)
    expect(await suggestFromLowPantry()).toHaveLength(0)
  })

  it('checkOffToPantry ohne foodId hakt nur ab; qty>1 erhöht entsprechend', async () => {
    const manual = await addShoppingItem({ name: 'Spülmittel' })
    await checkOffToPantry(manual.id)
    expect((await db.shoppingList.get(manual.id))!.checked).toBe(true)

    const food = await createFood({ name: 'Reis', ...base })
    const item = await addShoppingItem({ name: 'Reis', foodId: food.id, qty: 3 })
    await checkOffToPantry(item.id)
    expect((await db.foods.get(food.id))!).toMatchObject({ pantry: true, pantryQty: 3 })

    // Doppeltes Abhaken erhöht nicht erneut (idempotent).
    await checkOffToPantry(item.id)
    expect((await db.foods.get(food.id))!.pantryQty).toBe(3)
  })
})
