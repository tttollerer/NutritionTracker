import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import { createFood } from './repo'

describe('createFood Dedupe', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('upsertet per Barcode statt ein Duplikat anzulegen (defaultPortion bleibt)', async () => {
    const first = await createFood({
      name: 'Skyr Natur',
      per: 'g',
      kcal: 63,
      protein: 11,
      carbs: 4,
      fat: 0.2,
      barcode: '4012345678901',
      source: 'openfoodfacts',
    })
    await db.foods.update(first.id, { defaultPortion: { amount: 150, unit: 'g' as const } })

    const second = await createFood({
      name: 'Skyr Natur 500g',
      per: 'g',
      kcal: 65,
      protein: 11.5,
      carbs: 4.1,
      fat: 0.2,
      barcode: '4012345678901',
      source: 'openfoodfacts',
    })

    expect(second.id).toBe(first.id)
    expect(await db.foods.count()).toBe(1)
    const stored = await db.foods.get(first.id)
    // Werte des Treffers aktualisiert …
    expect(stored).toMatchObject({ name: 'Skyr Natur 500g', kcal: 65, protein: 11.5 })
    // … übliche Portion bleibt erhalten.
    expect(stored!.defaultPortion).toEqual({ amount: 150, unit: 'g' })
    expect(stored!.createdAt).toBe(first.createdAt)
  })

  it('upsertet ersatzweise per Namens-Match (case-insensitiv, getrimmt)', async () => {
    const first = await createFood({ name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 })
    const second = await createFood({ name: '  apfel ', per: 'g', kcal: 54, protein: 0.4, carbs: 14.4, fat: 0.2 })

    expect(second.id).toBe(first.id)
    expect(await db.foods.count()).toBe(1)
    expect((await db.foods.get(first.id))!.kcal).toBe(54)
  })

  it('Barcode gewinnt vor Namens-Match und wird beim Namens-Treffer nachgetragen', async () => {
    const plain = await createFood({ name: 'Müsli', per: 'g', kcal: 380, protein: 10, carbs: 60, fat: 8 })
    const withCode = await createFood({
      name: 'Müsli',
      per: 'g',
      kcal: 385,
      protein: 10,
      carbs: 61,
      fat: 8,
      barcode: '111',
    })
    expect(withCode.id).toBe(plain.id)
    expect((await db.foods.get(plain.id))!.barcode).toBe('111')
  })

  it('legt bei neuem Namen/Barcode weiterhin einen neuen Eintrag an', async () => {
    await createFood({ name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 })
    await createFood({ name: 'Birne', per: 'g', kcal: 57, protein: 0.4, carbs: 15, fat: 0.1 })
    expect(await db.foods.count()).toBe(2)
  })

  it('matcht keine soft-gelöschten Einträge', async () => {
    const first = await createFood({ name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 })
    await db.foods.update(first.id, { deletedAt: Date.now() })
    const second = await createFood({ name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 })
    expect(second.id).not.toBe(first.id)
    expect(await db.foods.count()).toBe(2)
  })
})
