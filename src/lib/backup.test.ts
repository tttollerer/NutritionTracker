import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { BACKUP_VERSION, InvalidBackupError, exportBackup, importBackup } from './backup'

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

/** jsdom-Blob hat kein .text() — über FileReader lesen (wie es der Browser auch könnte). */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsText(blob)
  })
}

const food = {
  id: 'food-1',
  name: 'Apfel',
  source: 'manual',
  per: 'g',
  kcal: 52,
  protein: 0.3,
  carbs: 14,
  fat: 0.2,
  createdAt: 1,
  updatedAt: 1,
}

const log = {
  id: 'log-1',
  foodId: 'food-1',
  date: '2026-07-01',
  meal: 'lunch',
  loggedAt: 2,
  amount: 150,
  unit: 'g',
  computed: { kcal: 78, protein: 0.5, carbs: 21, fat: 0.3 },
  updatedAt: 2,
}

const measurement = {
  id: 'meas-1',
  type: 'weight',
  value: 81.5,
  unit: 'kg',
  date: '2026-07-01',
  loggedAt: 3,
  updatedAt: 3,
}

const water = { id: 'water-1', date: '2026-07-01', ml: 250, loggedAt: 4, updatedAt: 4 }

async function seed() {
  await db.foods.put(structuredClone(food) as never)
  await db.logs.put(structuredClone(log) as never)
  await db.measurements.put(structuredClone(measurement) as never)
  await db.water.put(structuredClone(water) as never)
}

describe('backup export/import', () => {
  beforeEach(async () => {
    await clearAll()
    localStorage.clear()
  })

  it('exportiert measurements und round-trippt alle Stores verlustfrei', async () => {
    await seed()

    const blob = await exportBackup()
    const json = await blobText(blob)
    const parsed = JSON.parse(json)

    expect(parsed.version).toBe(BACKUP_VERSION)
    expect(parsed.measurements).toHaveLength(1)
    expect(parsed.measurements[0]).toMatchObject({ id: 'meas-1', type: 'weight', value: 81.5 })

    // Alles löschen und aus dem Backup wiederherstellen.
    await clearAll()
    await importBackup(json)

    expect(await db.foods.get('food-1')).toMatchObject(food)
    expect(await db.logs.get('log-1')).toMatchObject(log)
    expect(await db.measurements.get('meas-1')).toMatchObject(measurement)
    expect(await db.water.get('water-1')).toMatchObject(water)
  })

  it('round-trippt die Vorrat-/Haushaltskassen-Felder (pantry, price, defaultPortion.label, cost)', async () => {
    // Passthrough-Schema: neue optionale Felder müssen Export/Import verlustfrei überstehen.
    const pantryFood = {
      ...food,
      id: 'food-p',
      name: 'Haferflocken',
      pantry: true,
      price: { amount: 2.49, per: 500 },
      defaultPortion: { amount: 80, unit: 'g', label: 'Tasse' },
    }
    const costLog = { ...log, id: 'log-p', foodId: 'food-p', cost: 0.4 }
    await db.foods.put(structuredClone(pantryFood) as never)
    await db.logs.put(structuredClone(costLog) as never)

    const json = await blobText(await exportBackup())
    await clearAll()
    await importBackup(json)

    expect(await db.foods.get('food-p')).toMatchObject(pantryFood)
    expect(await db.logs.get('log-p')).toMatchObject(costLog)
  })

  it('round-trippt Theme-Modus und -Variante (Audit-Befund 16)', async () => {
    await seed()
    localStorage.setItem('nt-theme-mode', 'dark')
    localStorage.setItem('nt-theme-variant', 'classic')

    const json = await blobText(await exportBackup())
    const parsed = JSON.parse(json)
    expect(parsed.theme).toEqual({ mode: 'dark', variant: 'classic' })

    // "Neues Gerät": weder Daten noch Theme vorhanden.
    await clearAll()
    localStorage.clear()
    await importBackup(json)

    expect(localStorage.getItem('nt-theme-mode')).toBe('dark')
    expect(localStorage.getItem('nt-theme-variant')).toBe('classic')
    expect(await db.foods.get('food-1')).toMatchObject(food)
  })

  it('ignoriert unbekannte Theme-Werte und Backups ohne Theme-Feld', async () => {
    // Ohne gesetztes Theme fehlt das Feld im Export komplett.
    const json = await blobText(await exportBackup())
    expect(JSON.parse(json).theme).toBeUndefined()
    await importBackup(json) // darf nicht werfen

    // Kaputte/fremde Theme-Werte werden nicht in den Storage übernommen.
    localStorage.setItem('nt-theme-mode', 'light')
    await importBackup(JSON.stringify({ version: 2, theme: { mode: 'neon', variant: 'rainbow' } }))
    expect(localStorage.getItem('nt-theme-mode')).toBe('light')
    expect(localStorage.getItem('nt-theme-variant')).toBeNull()
  })

  it('bricht bei kaputtem JSON ohne Datenverlust ab', async () => {
    await seed()
    await expect(importBackup('das ist kein json {')).rejects.toBeInstanceOf(InvalidBackupError)
    expect(await db.foods.count()).toBe(1)
    expect(await db.measurements.count()).toBe(1)
  })

  it('bricht bei strukturell ungültiger Datei ohne Datenverlust ab', async () => {
    await seed()
    // Fehlende version
    await expect(importBackup(JSON.stringify({ foods: [] }))).rejects.toBeInstanceOf(InvalidBackupError)
    // Datensatz ohne id
    await expect(
      importBackup(JSON.stringify({ version: 2, foods: [{ name: 'ohne id' }] })),
    ).rejects.toBeInstanceOf(InvalidBackupError)
    // Zukünftige, unbekannte Formatversion
    await expect(importBackup(JSON.stringify({ version: 99 }))).rejects.toBeInstanceOf(InvalidBackupError)

    expect(await db.foods.get('food-1')).toMatchObject(food)
    expect(await db.logs.count()).toBe(1)
    expect(await db.measurements.count()).toBe(1)
    expect(await db.water.count()).toBe(1)
  })

  it('importiert v1-Dateien (ohne measurements) und lässt vorhandene Messwerte unangetastet', async () => {
    await seed()

    const v1 = JSON.stringify({
      version: 1,
      exportedAt: 123,
      foods: [{ ...food, id: 'food-2', name: 'Banane' }],
      logs: [],
      goals: [],
      profile: [],
      achievements: [],
      challenges: [],
      gamification: [],
      coachMemory: [],
      water: [],
      photos: [],
      settings: [],
      glucose: [],
    })

    await importBackup(v1)

    // In der Datei enthaltene Tabellen wurden ersetzt …
    expect(await db.foods.count()).toBe(1)
    expect(await db.foods.get('food-2')).toBeDefined()
    expect(await db.logs.count()).toBe(0)
    expect(await db.water.count()).toBe(0)
    // … die in v1 unbekannte measurements-Tabelle blieb erhalten (kein Datenverlust).
    expect(await db.measurements.get('meas-1')).toMatchObject(measurement)
  })
})
