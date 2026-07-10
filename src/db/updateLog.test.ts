import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import { createFood, deleteLog, logFood, restoreLog, updateLog } from './repo'

async function seedLog() {
  const food = await createFood({
    name: 'Haferflocken',
    per: 'g',
    kcal: 370,
    protein: 13,
    carbs: 59,
    fat: 7,
    micros: { iron: 4 },
  })
  const entry = await logFood({ food, date: '2026-07-05', meal: 'breakfast', amount: 100, unit: 'g' })
  return { food, entry }
}

describe('updateLog', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('berechnet den computed-Snapshot bei Mengenänderung neu', async () => {
    const { entry } = await seedLog()
    expect(entry.computed).toMatchObject({ kcal: 370, protein: 13, micros: { iron: 4 } })

    const updated = await updateLog(entry.id, { amount: 50 })

    expect(updated).toBeDefined()
    expect(updated!.amount).toBe(50)
    expect(updated!.computed).toMatchObject({ kcal: 185, protein: 6.5, carbs: 29.5, fat: 3.5 })
    expect(updated!.computed.micros).toEqual({ iron: 2 })
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt)
    // Persistiert, nicht nur zurückgegeben:
    expect((await db.logs.get(entry.id))!.computed.kcal).toBe(185)
  })

  it('rechnet portion über defaultPortion des Lebensmittels um', async () => {
    const { food, entry } = await seedLog()
    // logFood(100 g) hat defaultPortion {100, g} gemerkt → 2 Portionen = 200 g.
    expect((await db.foods.get(food.id))!.defaultPortion).toEqual({ amount: 100, unit: 'g' })

    const updated = await updateLog(entry.id, { amount: 2, unit: 'portion' })

    expect(updated!.unit).toBe('portion')
    expect(updated!.computed.kcal).toBe(740)
    expect(updated!.computed.protein).toBe(26)
  })

  it('wechselt die Mahlzeit, ohne die Werte zu verändern', async () => {
    const { entry } = await seedLog()
    const updated = await updateLog(entry.id, { meal: 'dinner' })
    expect(updated!.meal).toBe('dinner')
    expect(updated!.amount).toBe(entry.amount)
    expect(updated!.computed).toEqual(entry.computed)
  })

  it('Portionseinheiten: serving-Snapshot wird gesetzt, umgerechnet und bereinigt', async () => {
    const food = await createFood({
      name: 'Double Choc Cookies',
      per: 'g',
      kcal: 500,
      protein: 5,
      carbs: 60,
      fat: 25,
      servings: [{ label: 'Stück', amount: 22 }],
    })
    // „Ganze Packung" (225 g) geloggt …
    const entry = await logFood({ food, date: '2026-07-10', meal: 'breakfast', amount: 225, unit: 'g' })
    expect(entry.computed.kcal).toBe(1125)
    expect(entry.serving).toBeUndefined()

    // … und auf „2 Stück" korrigiert: Basis-Menge 44 g, Snapshot fürs UI.
    const updated = await updateLog(entry.id, {
      amount: 44,
      unit: 'g',
      serving: { label: 'Stück', count: 2 },
    })
    expect(updated!.computed.kcal).toBe(220)
    expect(updated!.serving).toEqual({ label: 'Stück', count: 2 })

    // Mengenänderung OHNE serving-Patch macht „2 Stück" unwahr → Snapshot weg.
    const replain = await updateLog(entry.id, { amount: 50 })
    expect(replain!.serving).toBeUndefined()
    expect((await db.logs.get(entry.id))!.serving).toBeUndefined()
  })

  it('logFood persistiert den serving-Snapshot (Anzeige „2 Stück")', async () => {
    const food = await createFood({
      name: 'Wulle Hell',
      per: 'ml',
      kcal: 42,
      protein: 0.5,
      carbs: 3,
      fat: 0,
      servings: [{ label: 'Dose', amount: 500 }],
    })
    const entry = await logFood({
      food,
      date: '2026-07-10',
      meal: 'dinner',
      amount: 500,
      unit: 'ml',
      serving: { label: 'Dose', count: 1 },
    })
    expect(entry.computed.kcal).toBe(210)
    expect((await db.logs.get(entry.id))!.serving).toEqual({ label: 'Dose', count: 1 })
  })

  it('fasst gelöschte oder fehlende Einträge nicht an', async () => {
    const { entry } = await seedLog()
    await deleteLog(entry.id)
    expect(await updateLog(entry.id, { amount: 10 })).toBeUndefined()
    expect(await updateLog('gibt-es-nicht', { amount: 10 })).toBeUndefined()
    expect((await db.logs.get(entry.id))!.amount).toBe(100)
  })
})

describe('deleteLog + restoreLog (Soft-Delete mit Undo)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('soft-deletet und stellt per Undo wieder her', async () => {
    const { entry } = await seedLog()

    await deleteLog(entry.id)
    const deleted = await db.logs.get(entry.id)
    expect(deleted!.deletedAt).toBeTypeOf('number')
    const visible = await db.logs.filter((l) => !l.deletedAt).toArray()
    expect(visible).toHaveLength(0)

    await restoreLog(entry.id)
    const restored = await db.logs.get(entry.id)
    expect(restored!.deletedAt).toBeUndefined()
    // Tombstone-Feld wirklich entfernt (sync-sauber), nicht nur auf undefined gesetzt:
    expect('deletedAt' in restored!).toBe(false)
    expect(await db.logs.filter((l) => !l.deletedAt).count()).toBe(1)
    expect(restored!.computed).toEqual(entry.computed)
  })
})
