import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import {
  addToPantry,
  computeCost,
  createFood,
  logFood,
  pantryFoods,
  saveReviewToPantry,
  setFoodPrice,
  setPantry,
  updateLog,
} from './repo'
import { setPantryQty } from '@/lib/pantryStock'

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }

describe('Mein Vorrat (pantry)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('setPantry setzt das Flag und entfernt das Feld beim Abwählen (sync-sauber)', async () => {
    const food = await createFood({ name: 'Haferflocken', ...base })

    await setPantry(food.id, true)
    expect((await db.foods.get(food.id))!.pantry).toBe(true)

    await setPantry(food.id, false)
    const stored = await db.foods.get(food.id)
    expect(stored!.pantry).toBeUndefined()
    expect('pantry' in stored!).toBe(false)
  })

  it('setPantry(false) räumt auch Packungszähler und MHD ab (kein staler Bestand)', async () => {
    const food = await addToPantry({ name: 'Skyr', ...base, barcode: '555' })
    await addToPantry({ name: 'Skyr', ...base, barcode: '555' })
    await addToPantry({ name: 'Skyr', ...base, barcode: '555' }) // 3 Packungen
    await db.foods.update(food.id, { expiryDate: '2026-07-01' })

    await setPantry(food.id, false)
    const cleared = (await db.foods.get(food.id))!
    expect('pantry' in cleared).toBe(false)
    expect('pantryQty' in cleared).toBe(false)
    expect('expiryDate' in cleared).toBe(false)

    // Später neu gescannt: wieder genau 1 Packung, kein altes MHD.
    await addToPantry({ name: 'Skyr', ...base, barcode: '555' })
    const again = (await db.foods.get(food.id))!
    expect(again.pantry).toBe(true)
    expect(again.pantryQty ?? 1).toBe(1)
    expect(again.expiryDate).toBeUndefined()
  })

  it('pantryFoods liefert nur Vorrat-Items (nicht gelöscht), zuletzt aktualisierte zuerst', async () => {
    const a = await createFood({ name: 'A', ...base })
    const b = await createFood({ name: 'B', ...base })
    const c = await createFood({ name: 'C', ...base })
    const d = await createFood({ name: 'D', ...base })
    await setPantry(a.id, true)
    await setPantry(b.id, true)
    await setPantry(c.id, true)
    // d bleibt ohne Flag; c wird soft-gelöscht.
    await db.foods.update(c.id, { deletedAt: Date.now() })
    // a zuletzt anfassen → muss vor b stehen.
    await db.foods.update(a.id, { updatedAt: Date.now() + 1000 })

    const list = await pantryFoods()
    expect(list.map((f) => f.name)).toEqual(['A', 'B'])
    expect(list.find((f) => f.id === d.id)).toBeUndefined()
  })

  it('createFood-Upsert überschreibt pantry/favorite/price des Bestands-Items NICHT', async () => {
    const first = await createFood({ name: 'Skyr', ...base, barcode: '111' })
    await setPantry(first.id, true)
    await db.foods.update(first.id, { favorite: true, price: { amount: 1.19, per: 500 } })

    const second = await createFood({ name: 'Skyr Natur', ...base, kcal: 63, barcode: '111' })

    expect(second.id).toBe(first.id)
    const stored = await db.foods.get(first.id)
    expect(stored).toMatchObject({
      name: 'Skyr Natur',
      kcal: 63,
      pantry: true,
      favorite: true,
      price: { amount: 1.19, per: 500 },
    })
  })

  it('addToPantry upsertet per Barcode, setzt pantry und merkt die Portion (mit Label)', async () => {
    const food = await addToPantry(
      { name: 'Haferflocken', ...base, barcode: '222' },
      { amount: 80, unit: 'g', label: 'Tasse' },
    )
    const stored = await db.foods.get(food.id)
    expect(stored!.pantry).toBe(true)
    expect(stored!.defaultPortion).toEqual({ amount: 80, unit: 'g', label: 'Tasse' })
    expect(await db.logs.count()).toBe(0)

    // 'portion'-Mengen werden NICHT als defaultPortion gemerkt (wie logFood).
    const other = await addToPantry({ name: 'Riegel', ...base }, { amount: 1, unit: 'portion' })
    expect((await db.foods.get(other.id))!.defaultPortion).toBeUndefined()
  })

  it('addToPantry zählt Packungen hoch statt zu duplizieren (Barcode- & Namens-Match)', async () => {
    const first = await addToPantry({ name: 'Skyr', ...base, barcode: '333' })
    // Erste Packung bleibt implizit (pantryQty-Konvention: undefined == 1).
    expect((await db.foods.get(first.id))!.pantryQty).toBeUndefined()

    const second = await addToPantry({ name: 'Skyr', ...base, barcode: '333' })
    expect(second.id).toBe(first.id)
    expect(await db.foods.count()).toBe(1)
    expect((await db.foods.get(first.id))!.pantryQty).toBe(2)

    // Ohne Barcode greift der exakte Namens-Match des createFood-Dedupe.
    const third = await addToPantry({ name: 'Skyr', ...base })
    expect(third.id).toBe(first.id)
    expect((await db.foods.get(first.id))!.pantryQty).toBe(3)
  })

  it('addToPantry füllt eine leere Packung (qty 0) wieder auf 1 auf', async () => {
    const food = await addToPantry({ name: 'Nudeln', ...base })
    await setPantryQty(food.id, 0)
    await addToPantry({ name: 'Nudeln', ...base })
    expect((await db.foods.get(food.id))!.pantryQty).toBe(1)
  })

  it('saveReviewToPantry erhöht den Bestand eines bereits vorrätigen Produkts', async () => {
    const existing = await addToPantry({ name: 'Müsli', ...base })
    const foods = await saveReviewToPantry(
      [{ name: 'Müsli', amount: 50, unit: 'g', per100: { kcal: 380, protein: 10, carbs: 60, fat: 8 } }],
      { source: 'ai' },
    )
    expect(foods[0].id).toBe(existing.id)
    expect(await db.foods.count()).toBe(1)
    expect((await db.foods.get(existing.id))!.pantryQty).toBe(2)
  })

  it('saveReviewToPantry erzeugt FoodItems (pantry, defaultPortion) und KEINE Logs', async () => {
    const foods = await saveReviewToPantry(
      [
        { name: 'Müsli', amount: 50, unit: 'g', per100: { kcal: 380, protein: 10, carbs: 60, fat: 8 } },
        { name: 'Hafermilch', amount: 200, unit: 'ml', per100: { kcal: 46, protein: 1, carbs: 6.6, fat: 1.5 } },
      ],
      { source: 'ai' },
    )

    expect(foods).toHaveLength(2)
    expect(await db.foods.count()).toBe(2)
    expect(await db.logs.count()).toBe(0)
    const milk = await db.foods.get(foods[1].id)
    expect(milk).toMatchObject({ per: 'ml', pantry: true, defaultPortion: { amount: 200, unit: 'ml' } })
  })

  it('Log aus dem Vorrat nutzt die gemerkte defaultPortion (Werte skaliert)', async () => {
    const food = await addToPantry({ name: 'Haferflocken', ...base, kcal: 370 }, { amount: 80, unit: 'g', label: 'Tasse' })
    // 1-Tap-Log wie in Add.quickLog: gemerkte Portion als Menge/Einheit.
    const stored = (await db.foods.get(food.id))!
    const entry = await logFood({
      food: stored,
      date: '2026-07-09',
      meal: 'breakfast',
      amount: stored.defaultPortion!.amount,
      unit: stored.defaultPortion!.unit,
    })
    expect(entry.amount).toBe(80)
    expect(entry.computed.kcal).toBe(Math.round(370 * 0.8))
    // Menge & Einheit unverändert → Portions-Label bleibt erhalten.
    expect((await db.foods.get(food.id))!.defaultPortion).toEqual({ amount: 80, unit: 'g', label: 'Tasse' })
  })

  it('logFood verwirft ein Portions-Label, wenn eine andere Menge geloggt wird', async () => {
    const food = await addToPantry({ name: 'Schokolade', ...base }, { amount: 25, unit: 'g', label: 'Riegel' })
    const stored = (await db.foods.get(food.id))!
    await logFood({ food: stored, date: '2026-07-09', meal: 'snack', amount: 50, unit: 'g' })
    expect((await db.foods.get(food.id))!.defaultPortion).toEqual({ amount: 50, unit: 'g' })
  })
})

describe('Haushaltskasse (price/cost)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('computeCost: 50 g aus 500-g-Packung à 2,49 € → 0,25 € (auf Cent gerundet)', () => {
    const food = { ...base, id: 'x', name: 'Reis', source: 'manual', price: { amount: 2.49, per: 500 }, createdAt: 0, updatedAt: 0 } as never
    expect(computeCost(food, 50, 'g')).toBe(0.25)
    expect(computeCost(food, 500, 'g')).toBe(2.49)
  })

  it('computeCost löst portion über defaultPortion auf; ohne Preis → undefined', () => {
    const priced = {
      ...base,
      id: 'y',
      name: 'Haferflocken',
      source: 'manual',
      price: { amount: 2, per: 400 },
      defaultPortion: { amount: 80, unit: 'g' },
      createdAt: 0,
      updatedAt: 0,
    } as never
    expect(computeCost(priced, 1, 'portion')).toBe(0.4)

    const unpriced = { ...base, id: 'z', name: 'Apfel', source: 'manual', createdAt: 0, updatedAt: 0 } as never
    expect(computeCost(unpriced, 100, 'g')).toBeUndefined()
  })

  it('logFood schreibt einen Kosten-Snapshot; ohne Preis bleibt das Feld weg', async () => {
    const priced = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(priced.id, { amount: 2.49, per: 500 })
    const entry = await logFood({
      food: (await db.foods.get(priced.id))!,
      date: '2026-07-09',
      meal: 'dinner',
      amount: 50,
      unit: 'g',
    })
    expect(entry.cost).toBe(0.25)
    expect((await db.logs.get(entry.id))!.cost).toBe(0.25)

    const free = await createFood({ name: 'Apfel', ...base })
    const freeEntry = await logFood({ food: free, date: '2026-07-09', meal: 'snack', amount: 100, unit: 'g' })
    expect(freeEntry.cost).toBeUndefined()
    expect('cost' in (await db.logs.get(freeEntry.id))!).toBe(false)
  })

  it('Snapshot bleibt stabil, wenn der Preis später geändert wird; updateLog rechnet mit aktuellem Preis neu', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2.49, per: 500 })
    const entry = await logFood({ food: (await db.foods.get(food.id))!, date: '2026-07-09', meal: 'dinner', amount: 50, unit: 'g' })

    // Preisänderung berührt bestehende Snapshots nicht …
    await setFoodPrice(food.id, { amount: 5, per: 500 })
    expect((await db.logs.get(entry.id))!.cost).toBe(0.25)

    // … erst eine Log-Änderung rechnet mit dem aktuellen Preis neu.
    const updated = await updateLog(entry.id, { amount: 100 })
    expect(updated!.cost).toBe(1)
  })

  it('setFoodPrice entfernt den Preis mit undefined und verwirft ungültige Werte', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2.49, per: 500 })
    expect((await db.foods.get(food.id))!.price).toEqual({ amount: 2.49, per: 500 })

    await setFoodPrice(food.id, undefined)
    const cleared = await db.foods.get(food.id)
    expect('price' in cleared!).toBe(false)

    await setFoodPrice(food.id, { amount: 2, per: 0 }) // Packungsgröße 0 → ungültig
    expect((await db.foods.get(food.id))!.price).toBeUndefined()
  })
})
