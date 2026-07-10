import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { NutritionDB } from './index'

/** Schema-Stand v4 (vor der v5-Migration) — exakt wie historisch ausgeliefert. */
function openV4(name: string) {
  const d = new Dexie(name)
  d.version(1).stores({
    foods: 'id, name, barcode, updatedAt, deletedAt',
    logs: 'id, foodId, date, meal, updatedAt, deletedAt, [date+meal]',
    goals: 'id, nutrient, active, updatedAt, deletedAt',
    profile: 'id, updatedAt',
    achievements: 'id, key, unlockedAt',
    challenges: 'id, status, period, updatedAt',
    gamification: 'id, updatedAt',
    coachMemory: 'id, updatedAt',
    water: 'id, date, loggedAt',
  })
  d.version(2).stores({ photos: 'id, createdAt' })
  d.version(3).stores({
    settings: 'id, updatedAt',
    glucose: 'id, date, loggedAt, deletedAt',
  })
  d.version(4).stores({
    measurements: 'id, type, date, loggedAt, deletedAt, [type+date]',
  })
  return d
}

describe('Dexie v4 → v5 Migration', () => {
  it('ergänzt updatedAt auf Bestandsdaten und erhält alle Daten', async () => {
    const name = `migration-test-${Date.now()}`
    const old = openV4(name)
    await old.table('water').bulkPut([
      { id: 'w1', date: '2026-07-01', ml: 250, loggedAt: 10 },
      { id: 'w2', date: '2026-07-02', ml: 500, loggedAt: 20 },
    ])
    await old.table('photos').put({ id: 'p1', dataUrl: 'data:image/jpeg;base64,x', createdAt: 30 })
    await old.table('foods').put({ id: 'f1', name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, source: 'manual', createdAt: 1, updatedAt: 1 })
    await old.table('measurements').put({ id: 'm1', type: 'weight', value: 80, unit: 'kg', date: '2026-07-01', loggedAt: 40, updatedAt: 40 })
    old.close()

    const before = Date.now()
    const fresh = new NutritionDB(name)
    await fresh.open()
    expect(fresh.verno).toBe(6)

    // Bestandsdaten intakt + updatedAt nachgerüstet.
    const w1 = await fresh.water.get('w1')
    const w2 = await fresh.water.get('w2')
    const p1 = await fresh.photos.get('p1')
    expect(w1).toMatchObject({ date: '2026-07-01', ml: 250, loggedAt: 10 })
    expect(w1!.updatedAt).toBeGreaterThanOrEqual(before)
    expect(w2!.updatedAt).toBeGreaterThanOrEqual(before)
    expect(p1).toMatchObject({ dataUrl: 'data:image/jpeg;base64,x', createdAt: 30 })
    expect(p1!.updatedAt).toBeGreaterThanOrEqual(before)

    // Andere Tabellen unangetastet.
    expect(await fresh.foods.get('f1')).toMatchObject({ name: 'Apfel', updatedAt: 1 })
    expect(await fresh.measurements.get('m1')).toMatchObject({ value: 80, updatedAt: 40 })

    await fresh.delete()
  })

  it('ist idempotent: bereits gesetzte updatedAt-Werte bleiben unverändert', async () => {
    const name = `migration-idem-${Date.now()}`
    const old = openV4(name)
    // Datensatz, der (z. B. durch einen früheren Migrationslauf) schon updatedAt trägt.
    await old.table('water').put({ id: 'w1', date: '2026-07-01', ml: 250, loggedAt: 10, updatedAt: 111 })
    old.close()

    const fresh = new NutritionDB(name)
    await fresh.open()
    expect((await fresh.water.get('w1'))!.updatedAt).toBe(111)
    await fresh.delete()
  })
})

/** Schema-Stand v5 (vor der v6-Migration) — exakt wie historisch ausgeliefert. */
function openV5(name: string) {
  const d = openV4(name)
  d.version(5).stores({
    water: 'id, date, loggedAt, updatedAt, deletedAt',
    photos: 'id, createdAt, updatedAt, deletedAt',
  })
  return d
}

describe('Dexie v5 → v6 Migration (Einkaufsliste & Rezepte)', () => {
  it('legt die neuen Tabellen an und lässt Bestandsdaten unangetastet', async () => {
    const name = `migration-v6-${Date.now()}`
    const old = openV5(name)
    await old.table('foods').put({ id: 'f1', name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, source: 'manual', createdAt: 1, updatedAt: 1 })
    await old.table('logs').put({ id: 'l1', foodId: 'f1', date: '2026-07-01', meal: 'snack', loggedAt: 5, amount: 100, unit: 'g', computed: { kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 }, updatedAt: 5 })
    old.close()

    const fresh = new NutritionDB(name)
    await fresh.open()
    expect(fresh.verno).toBe(6)

    // Bestandsdaten intakt.
    expect(await fresh.foods.get('f1')).toMatchObject({ name: 'Apfel', updatedAt: 1 })
    expect(await fresh.logs.get('l1')).toMatchObject({ foodId: 'f1', amount: 100 })

    // Neue Tabellen leer, aber les-/schreibbar (Index auf checked/name nutzbar).
    expect(await fresh.shoppingList.count()).toBe(0)
    expect(await fresh.recipes.count()).toBe(0)
    await fresh.shoppingList.put({ id: 's1', name: 'Milch', source: 'manual', checked: false, updatedAt: 1 })
    await fresh.recipes.put({ id: 'r1', name: 'Curry', portions: 4, ingredients: [], updatedAt: 1 })
    expect((await fresh.shoppingList.get('s1'))!.name).toBe('Milch')
    expect((await fresh.recipes.where('name').equals('Curry').first())!.id).toBe('r1')

    await fresh.delete()
  })
})
