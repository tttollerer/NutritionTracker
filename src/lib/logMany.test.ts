import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood, setPantry } from '@/db/repo'
import { effectivePantryQty, setPantryQty } from './pantryStock'
import { logMany, undoLogMany, usualPortion, usualPortionKcal } from './logMany'

const base = { per: 'g' as const, kcal: 200, protein: 10, carbs: 20, fat: 5 }

describe('Mehrfach-Log aus dem Vorrat (logMany)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('usualPortion: defaultPortion, sonst 100 in der Basis-Einheit', async () => {
    const plain = await createFood({ name: 'Reis', ...base })
    expect(usualPortion(plain)).toEqual({ amount: 100, unit: 'g' })

    await db.foods.update(plain.id, { defaultPortion: { amount: 50, unit: 'g' } })
    expect(usualPortion((await db.foods.get(plain.id))!)).toEqual({ amount: 50, unit: 'g' })

    const drink = await createFood({ name: 'Hafermilch', ...base, per: 'ml' })
    expect(usualPortion(drink)).toEqual({ amount: 100, unit: 'ml' })
  })

  it('usualPortionKcal skaliert die 100er-Referenz auf die übliche Portion', async () => {
    const food = await createFood({ name: 'Skyr', ...base }) // 200 kcal / 100 g
    expect(usualPortionKcal(food)).toBe(200)
    await db.foods.update(food.id, { defaultPortion: { amount: 150, unit: 'g' } })
    expect(usualPortionKcal((await db.foods.get(food.id))!)).toBe(300)
  })

  it('loggt alle Foods mit üblicher Portion für Mahlzeit/Datum und zählt den Bestand runter', async () => {
    const a = await createFood({ name: 'Nudeln', ...base })
    const b = await createFood({ name: 'Pesto', ...base })
    await setPantryQty(a.id, 3)
    await setPantry(b.id, true) // qty undefined == 1
    await db.foods.update(a.id, { defaultPortion: { amount: 125, unit: 'g' } })

    const foods = [(await db.foods.get(a.id))!, (await db.foods.get(b.id))!]
    const logged = await logMany(foods, 'dinner', '2026-07-11')

    expect(logged).toHaveLength(2)
    expect(logged.every((l) => l.took)).toBe(true)
    expect(logged[0].entry).toMatchObject({ meal: 'dinner', date: '2026-07-11', amount: 125, unit: 'g' })
    expect(logged[0].entry.computed.kcal).toBe(250)
    expect(logged[1].entry).toMatchObject({ amount: 100, unit: 'g' })

    // Je Produkt ging genau eine Packung ab.
    expect((await db.foods.get(a.id))!.pantryQty).toBe(2)
    expect((await db.foods.get(b.id))!.pantryQty).toBe(0)
  })

  it('took=false bei leerer Packung oder ohne Vorrat-Bezug — Bestand bleibt unangetastet', async () => {
    const empty = await createFood({ name: 'Milch', ...base })
    await setPantryQty(empty.id, 0)
    const plain = await createFood({ name: 'Apfel', ...base })

    const logged = await logMany([(await db.foods.get(empty.id))!, plain], 'snack')
    // Geloggt wird trotzdem — nur der Bestand ändert sich nicht.
    expect(logged.map((l) => l.took)).toEqual([false, false])
    expect((await db.foods.get(empty.id))!.pantryQty).toBe(0)
    expect((await db.foods.get(plain.id))!.pantry).toBeUndefined()
  })

  it('undoLogMany löscht alle Logs und legt NUR abgezogene Packungen zurück', async () => {
    const a = await createFood({ name: 'Nudeln', ...base })
    const b = await createFood({ name: 'Milch', ...base })
    await setPantryQty(a.id, 2)
    await setPantryQty(b.id, 0) // schon leer → kein Abzug, kein Zurücklegen

    const logged = await logMany([(await db.foods.get(a.id))!, (await db.foods.get(b.id))!], 'dinner')
    expect((await db.foods.get(a.id))!.pantryQty).toBe(1)

    await undoLogMany(logged)
    for (const l of logged) {
      expect((await db.logs.get(l.entry.id))!.deletedAt).toBeGreaterThan(0)
    }
    expect(effectivePantryQty((await db.foods.get(a.id))!)).toBe(2)
    expect((await db.foods.get(b.id))!.pantryQty).toBe(0)
  })
})
