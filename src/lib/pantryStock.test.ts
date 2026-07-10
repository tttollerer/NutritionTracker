import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { addToPantry, createFood, setFoodPrice, setPantry, PRICE_HISTORY_MAX } from '@/db/repo'
import {
  daysUntilExpiry,
  decrementPantryOnLog,
  effectivePantryQty,
  expiringSoon,
  incrementPantry,
  isExpiringSoon,
  lowPantryFoods,
  setExpiry,
  setPantryQty,
  undoPantryAdd,
} from './pantryStock'

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }

describe('Vorrats-Bestand (pantryQty)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Konvention: pantry=true ohne pantryQty zählt als 1 Packung', async () => {
    const food = await createFood({ name: 'Haferflocken', ...base })
    await setPantry(food.id, true)
    expect(effectivePantryQty((await db.foods.get(food.id))!)).toBe(1)
    expect(effectivePantryQty({ pantry: undefined })).toBe(0)
  })

  it('decrementPantryOnLog: undefined→0, bei 0 bleibt pantry=true (qty 0 = leer)', async () => {
    const food = await createFood({ name: 'Skyr', ...base })
    await setPantry(food.id, true)

    await decrementPantryOnLog(food.id)
    let stored = (await db.foods.get(food.id))!
    expect(stored.pantryQty).toBe(0)
    expect(stored.pantry).toBe(true)

    // Kein negativer Bestand.
    await decrementPantryOnLog(food.id)
    stored = (await db.foods.get(food.id))!
    expect(stored.pantryQty).toBe(0)
    expect(stored.pantry).toBe(true)
  })

  it('decrementPantryOnLog ohne pantry-Flag ist ein No-Op', async () => {
    const food = await createFood({ name: 'Apfel', ...base })
    await decrementPantryOnLog(food.id)
    const stored = (await db.foods.get(food.id))!
    expect(stored.pantry).toBeUndefined()
    expect(stored.pantryQty).toBeUndefined()
  })

  it('setPantryQty/incrementPantry pflegen den Zähler und setzen pantry', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setPantryQty(food.id, 3)
    expect((await db.foods.get(food.id))!).toMatchObject({ pantry: true, pantryQty: 3 })

    await incrementPantry(food.id, 2)
    expect((await db.foods.get(food.id))!.pantryQty).toBe(5)

    await decrementPantryOnLog(food.id)
    expect((await db.foods.get(food.id))!.pantryQty).toBe(4)
  })

  it('decrementPantryOnLog meldet, ob abgezogen wurde — Undo legt nur dann zurück', async () => {
    const food = await createFood({ name: 'Milch', ...base })
    await setPantry(food.id, true)
    expect(await decrementPantryOnLog(food.id)).toBe(true) // 1 → 0
    expect(await decrementPantryOnLog(food.id)).toBe(false) // schon leer

    const plain = await createFood({ name: 'Banane', ...base })
    expect(await decrementPantryOnLog(plain.id)).toBe(false) // kein Vorrat-Bezug
  })

  it('undoPantryAdd nimmt eine Packung zurück; die letzte entfernt Flag & Zähler', async () => {
    const food = await addToPantry({ name: 'Skyr', ...base, barcode: '444' })
    await addToPantry({ name: 'Skyr', ...base, barcode: '444' }) // 2 Packungen

    await undoPantryAdd(food.id)
    expect((await db.foods.get(food.id))!).toMatchObject({ pantry: true, pantryQty: 1 })

    await undoPantryAdd(food.id)
    const stored = (await db.foods.get(food.id))!
    expect('pantry' in stored).toBe(false)
    expect('pantryQty' in stored).toBe(false)

    // Ohne Vorrat-Flag ist der Undo ein No-Op.
    await undoPantryAdd(food.id)
    expect('pantry' in (await db.foods.get(food.id))!).toBe(false)
  })

  it('lowPantryFoods: qty<=1 (undefined zählt als 1), leere zuerst', async () => {
    const empty = await createFood({ name: 'Nudeln', ...base })
    const one = await createFood({ name: 'Milch', ...base })
    const full = await createFood({ name: 'Reis', ...base })
    const off = await createFood({ name: 'Apfel', ...base })
    await setPantryQty(empty.id, 0)
    await setPantry(one.id, true) // qty undefined == 1
    await setPantryQty(full.id, 4)
    void off // ohne pantry-Flag

    const low = await lowPantryFoods()
    expect(low.map((f) => f.name)).toEqual(['Nudeln', 'Milch'])
  })
})

describe('MHD (expiryDate)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('setExpiry setzt und entfernt (null) das MHD', async () => {
    const food = await createFood({ name: 'Joghurt', ...base })
    await setExpiry(food.id, '2026-07-12')
    expect((await db.foods.get(food.id))!.expiryDate).toBe('2026-07-12')

    await setExpiry(food.id, null)
    expect('expiryDate' in (await db.foods.get(food.id))!).toBe(false)
  })

  it('expiringSoon: Fenster inkl. abgelaufener, ohne leere Packungen, sortiert', async () => {
    const today = '2026-07-10'
    const expired = await createFood({ name: 'Quark', ...base })
    const soon = await createFood({ name: 'Joghurt', ...base })
    const later = await createFood({ name: 'Käse', ...base })
    const emptyPack = await createFood({ name: 'Milch', ...base })
    await setPantry(expired.id, true)
    await setExpiry(expired.id, '2026-07-09')
    await setPantry(soon.id, true)
    await setExpiry(soon.id, '2026-07-12')
    await setPantry(later.id, true)
    await setExpiry(later.id, '2026-07-20')
    await setPantryQty(emptyPack.id, 0) // leer → kein Verderb-Kandidat
    await setExpiry(emptyPack.id, '2026-07-11')

    const list = await expiringSoon(3, today)
    expect(list.map((f) => f.name)).toEqual(['Quark', 'Joghurt'])
  })

  it('daysUntilExpiry: 0 = heute, negativ = abgelaufen, über Monatsgrenzen hinweg', () => {
    expect(daysUntilExpiry('2026-07-10', '2026-07-10')).toBe(0)
    expect(daysUntilExpiry('2026-07-11', '2026-07-10')).toBe(1)
    expect(daysUntilExpiry('2026-07-09', '2026-07-10')).toBe(-1)
    expect(daysUntilExpiry('2026-08-02', '2026-07-30')).toBe(3)
  })

  it('isExpiringSoon: gleiche Regel wie expiringSoon (Fenster, leere Packung, kein MHD)', () => {
    const today = '2026-07-10'
    expect(isExpiringSoon({ pantry: true, expiryDate: '2026-07-13' }, 3, today)).toBe(true)
    expect(isExpiringSoon({ pantry: true, expiryDate: '2026-07-14' }, 3, today)).toBe(false)
    expect(isExpiringSoon({ pantry: true, expiryDate: '2026-07-01' }, 3, today)).toBe(true) // abgelaufen
    expect(isExpiringSoon({ pantry: true, pantryQty: 0, expiryDate: '2026-07-11' }, 3, today)).toBe(false)
    expect(isExpiringSoon({ pantry: true }, 3, today)).toBe(false)
    expect(isExpiringSoon({ expiryDate: '2026-07-11' }, 3, today)).toBe(false) // nicht im Vorrat
  })
})

describe('Preis-Verlauf (priceHistory)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Preisänderung archiviert den alten Preis (neueste zuerst)', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2.49, per: 500 })
    expect((await db.foods.get(food.id))!.priceHistory).toBeUndefined()

    await setFoodPrice(food.id, { amount: 2.99, per: 500 })
    let stored = (await db.foods.get(food.id))!
    expect(stored.price).toEqual({ amount: 2.99, per: 500 })
    expect(stored.priceHistory).toHaveLength(1)
    expect(stored.priceHistory![0]).toMatchObject({ amount: 2.49, per: 500 })
    expect(stored.priceHistory![0].at).toBeGreaterThan(0)

    await setFoodPrice(food.id, { amount: 3.49, per: 500 })
    stored = (await db.foods.get(food.id))!
    expect(stored.priceHistory!.map((p) => p.amount)).toEqual([2.99, 2.49])
  })

  it('gleicher Preis erzeugt keinen Verlaufseintrag; Entfernen archiviert', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2.49, per: 500 })
    await setFoodPrice(food.id, { amount: 2.49, per: 500 })
    expect((await db.foods.get(food.id))!.priceHistory).toBeUndefined()

    await setFoodPrice(food.id, undefined)
    const stored = (await db.foods.get(food.id))!
    expect('price' in stored).toBe(false)
    expect(stored.priceHistory![0]).toMatchObject({ amount: 2.49, per: 500 })
  })

  it('Rotation: der Verlauf ist auf PRICE_HISTORY_MAX Einträge gedeckelt', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    for (let i = 0; i <= PRICE_HISTORY_MAX + 2; i++) {
      await setFoodPrice(food.id, { amount: 1 + i * 0.1, per: 500 })
    }
    const stored = (await db.foods.get(food.id))!
    expect(stored.priceHistory).toHaveLength(PRICE_HISTORY_MAX)
    // Neueste zuerst: der jüngste abgelöste Preis steht vorn, der älteste fiel raus.
    expect(stored.priceHistory![0].amount).toBeCloseTo(1 + (PRICE_HISTORY_MAX + 1) * 0.1)
    expect(stored.priceHistory!.at(-1)!.amount).toBeCloseTo(1.2)
  })
})
