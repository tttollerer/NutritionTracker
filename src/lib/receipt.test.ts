import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { addToPantry, createFood, setFoodPrice } from '@/db/repo'
import {
  clearReceiptDraft,
  getReceiptDraft,
  saveReceiptToPantry,
  setReceiptDraft,
  undoReceiptSave,
} from './receipt'

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }

describe('Kassenbon → Vorrat (saveReceiptToPantry)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    sessionStorage.clear()
  })

  it('legt neue Positionen als Vorrats-Foods an (Stückzahl, per100, KEINE Logs)', async () => {
    const saved = await saveReceiptToPantry([
      { name: 'H-Milch 3,5 %', quantity: 2, per100: { kcal: 64, protein: 3.4, carbs: 4.8, fat: 3.5 } },
      { name: 'Bananen', quantity: 1 },
    ])

    expect(saved).toHaveLength(2)
    expect(await db.foods.count()).toBe(2)
    expect(await db.logs.count()).toBe(0)

    const milk = await db.foods.get(saved[0].food.id)
    expect(milk).toMatchObject({ pantry: true, pantryQty: 2, kcal: 64, source: 'ai' })
    // Ohne per100 entsteht ein Platzhalter mit 0-Werten (später per Label/Barcode füllbar).
    const bananas = await db.foods.get(saved[1].food.id)
    expect(bananas).toMatchObject({ pantry: true, kcal: 0 })
  })

  it('fasst ohne per100 gepflegte Bestandswerte NICHT an, zählt aber den Bestand hoch', async () => {
    const existing = await addToPantry({ name: 'Skyr', ...base, kcal: 63, source: 'openfoodfacts' })

    const saved = await saveReceiptToPantry([{ name: 'skyr', quantity: 3 }])
    expect(saved[0].food.id).toBe(existing.id)
    expect(await db.foods.count()).toBe(1)

    const stored = (await db.foods.get(existing.id))!
    expect(stored.kcal).toBe(63) // Bon kennt keine Nährwerte → nichts genullt
    expect(stored.source).toBe('openfoodfacts')
    expect(stored.pantryQty).toBe(4) // 1 vorhandene + 3 vom Bon
  })

  it('übernimmt den Positionspreis als Packungspreis (Gesamtpreis / Stück, per-Fallback 100)', async () => {
    const saved = await saveReceiptToPantry([
      { name: 'Joghurt', quantity: 2, price: 2.38, per100: { kcal: 60, protein: 4, carbs: 5, fat: 3 } },
    ])
    expect(saved[0].food.price).toEqual({ amount: 1.19, per: 100 })
    expect((await db.foods.get(saved[0].food.id))!.price).toEqual({ amount: 1.19, per: 100 })
  })

  it('behält eine bekannte Packungsgröße bei und archiviert den alten Preis (Historie)', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2.49, per: 500 })

    await saveReceiptToPantry([{ name: 'Reis', quantity: 1, price: 2.99 }])

    const stored = (await db.foods.get(food.id))!
    expect(stored.price).toEqual({ amount: 2.99, per: 500 })
    expect(stored.priceHistory?.[0]).toMatchObject({ amount: 2.49, per: 500 })
  })

  it('überspringt leere Namen und normalisiert krumme Stückzahlen defensiv', async () => {
    const saved = await saveReceiptToPantry([
      { name: '   ', quantity: 1 },
      { name: 'Äpfel', quantity: 0 }, // defensiv: min. 1 Packung
    ])
    expect(saved).toHaveLength(1)
    expect(await db.foods.count()).toBe(1)
    const apples = (await db.foods.get(saved[0].food.id))!
    expect(apples.pantry).toBe(true)
    expect(apples.pantryQty ?? 1).toBe(1)
  })

  it('undoReceiptSave nimmt genau die hinzugekommenen Packungen zurück', async () => {
    // Bestand vorher: 1 Packung Müsli.
    const existing = await addToPantry({ name: 'Müsli', ...base })

    const saved = await saveReceiptToPantry([
      { name: 'Müsli', quantity: 2 },
      { name: 'Hafermilch', quantity: 1 },
    ])
    expect((await db.foods.get(existing.id))!.pantryQty).toBe(3)

    await undoReceiptSave(saved)

    // Müsli: zurück auf die eine vorhandene Packung, Vorrats-Flag bleibt.
    const muesli = (await db.foods.get(existing.id))!
    expect(muesli.pantry).toBe(true)
    expect(muesli.pantryQty ?? 1).toBe(1)
    // Hafermilch war neu → fliegt ganz aus dem Vorrat (Flag weg, Item bleibt im Katalog).
    const milk = (await db.foods.get(saved[1].food.id))!
    expect(milk.pantry).toBeUndefined()
  })
})

describe('Kassenbon-Zwischenspeicher (sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear())

  it('set/get/clear-Roundtrip; kaputter Inhalt liefert null statt zu werfen', () => {
    expect(getReceiptDraft()).toBeNull()

    const items = [{ name: 'Bananen', quantity: 2, price: 1.29 }]
    setReceiptDraft(items)
    expect(getReceiptDraft()).toEqual(items)

    clearReceiptDraft()
    expect(getReceiptDraft()).toBeNull()

    sessionStorage.setItem('nt-receipt', '{ kaputt')
    expect(getReceiptDraft()).toBeNull()
  })
})
