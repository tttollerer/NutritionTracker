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

describe('createFood Quellen-Hierarchie (Befund 6: manual > OFF/USDA > ai)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('KI-Scan überschreibt ein OFF-Item NICHT (gepflegte Werte bleiben)', async () => {
    const off = await createFood({
      name: 'Skyr Natur',
      per: 'g',
      kcal: 63,
      protein: 11,
      carbs: 4,
      fat: 0.2,
      micros: { calcium: 150 },
      source: 'openfoodfacts',
    })

    const result = await createFood({
      name: 'Skyr Natur',
      per: 'g',
      kcal: 90,
      protein: 8,
      carbs: 6,
      fat: 2,
      source: 'ai',
    })

    // Name-Match liefert das Bestands-Item mit den gepflegten Werten zurück …
    expect(result.id).toBe(off.id)
    expect(result.kcal).toBe(63)
    // … und auch in der DB ist nichts überschrieben.
    const stored = await db.foods.get(off.id)
    expect(stored).toMatchObject({ kcal: 63, protein: 11, source: 'openfoodfacts' })
    expect(stored!.micros).toEqual({ calcium: 150 })
    expect(await db.foods.count()).toBe(1)
  })

  it('KI-Scan überschreibt ein manuell gepflegtes Item NICHT', async () => {
    const manual = await createFood({ name: 'Omas Eintopf', per: 'g', kcal: 120, protein: 7, carbs: 9, fat: 5 })
    const result = await createFood({ name: 'Omas Eintopf', per: 'g', kcal: 200, protein: 3, carbs: 20, fat: 10, source: 'ai' })
    expect(result.id).toBe(manual.id)
    expect((await db.foods.get(manual.id))!).toMatchObject({ kcal: 120, source: 'manual' })
  })

  it('OFF-Scan überschreibt ein manuell gepflegtes Item NICHT (manual ist oberste Stufe)', async () => {
    const manual = await createFood({ name: 'Skyr Natur', per: 'g', kcal: 65, protein: 12, carbs: 4, fat: 0.2 })
    const result = await createFood({
      name: 'Skyr Natur',
      per: 'g',
      kcal: 63,
      protein: 11,
      carbs: 4,
      fat: 0.2,
      source: 'openfoodfacts',
    })
    expect(result.id).toBe(manual.id)
    expect((await db.foods.get(manual.id))!).toMatchObject({ kcal: 65, protein: 12, source: 'manual' })
  })

  it('OFF-Scan aktualisiert ein KI-Item (bessere Quelle gewinnt)', async () => {
    const ai = await createFood({ name: 'Skyr Natur', per: 'g', kcal: 90, protein: 8, carbs: 6, fat: 2, source: 'ai' })

    const result = await createFood({
      name: 'Skyr Natur',
      per: 'g',
      kcal: 63,
      protein: 11,
      carbs: 4,
      fat: 0.2,
      barcode: '4012345678901',
      source: 'openfoodfacts',
    })

    expect(result.id).toBe(ai.id)
    expect(await db.foods.get(ai.id)).toMatchObject({
      kcal: 63,
      protein: 11,
      source: 'openfoodfacts',
      barcode: '4012345678901',
    })
  })

  it('gleiche Quelle aktualisiert weiterhin (ai über ai, OFF über OFF)', async () => {
    const ai = await createFood({ name: 'Bowl', per: 'g', kcal: 150, protein: 5, carbs: 20, fat: 4, source: 'ai' })
    await createFood({ name: 'Bowl', per: 'g', kcal: 160, protein: 6, carbs: 21, fat: 4, source: 'ai' })
    expect((await db.foods.get(ai.id))!.kcal).toBe(160)
  })
})
