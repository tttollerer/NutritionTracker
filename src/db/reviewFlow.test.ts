import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index'
import { createFood, findFoodByName, logFood } from './repo'
import { amountForUnitSwitch, presetsFor, MASS_PRESETS, PORTION_PRESETS } from '@/lib/reviewStore'

/**
 * Paket 9 (Review): Portion-Fehlbuchung + Lernschleife.
 * Audit-Befund: KI liefert unit='portion', Nutzer tippt Gramm-Preset „100"
 * → 100 Portionen à 100 g = 10.000 g in der DB.
 */

describe('Review-Portion: kein 10.000-g-Bug mehr', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Presets sind bei unit=portion Portionszähler (¼–2), keine Gramm-Werte', () => {
    // Der alte Bug entstand, weil die Gramm-Presets (100/150/…) auch bei
    // unit='portion' angeboten wurden. Jetzt: eigene Portions-Presets.
    expect(presetsFor('portion')).toEqual(PORTION_PRESETS)
    expect(presetsFor('portion')).not.toContain(100)
    expect(Math.max(...presetsFor('portion'))).toBeLessThanOrEqual(2)
    // g/ml behalten die konkreten Mengen.
    expect(presetsFor('g')).toEqual(MASS_PRESETS)
    expect(presetsFor('ml')).toEqual(MASS_PRESETS)
  })

  it('Einheitenwechsel übernimmt keinen Gramm-Wert als Portionszahl', () => {
    // 150 g → Portion: 1 Portion statt 150 Portionen.
    expect(amountForUnitSwitch(150, 'portion')).toBe(1)
    // 2 Portionen → g: sinnvolle 100-g-Vorbelegung statt „2 g".
    expect(amountForUnitSwitch(2, 'g')).toBe(100)
    // Plausible Werte bleiben unangetastet.
    expect(amountForUnitSwitch(1.5, 'portion')).toBe(1.5)
    expect(amountForUnitSwitch(150, 'ml')).toBe(150)
  })

  it('bucht 1 Portion eines frischen KI-Foods als 100-g-Basis (computeLogValues-Pfad)', async () => {
    const food = await createFood({ name: 'Linsencurry', per: 'g', kcal: 120, protein: 7, carbs: 15, fat: 3, source: 'ai' })
    const entry = await logFood({ food, date: '2026-07-05', meal: 'lunch', amount: 1, unit: 'portion' })
    // Ohne defaultPortion gilt 1 Portion = 100 g → exakt die per100-Werte.
    expect(entry.computed).toMatchObject({ kcal: 120, protein: 7, carbs: 15, fat: 3 })
  })

  it('Regression: der Maximal-Preset bei portion erzeugt keine 10.000-g-Buchung', async () => {
    const food = await createFood({ name: 'Pasta', per: 'g', kcal: 100, protein: 4, carbs: 20, fat: 1, source: 'ai' })
    const maxPreset = Math.max(...presetsFor('portion'))
    const entry = await logFood({ food, date: '2026-07-05', meal: 'dinner', amount: maxPreset, unit: 'portion' })
    // Vorher: amount=100 (Gramm-Preset) × 100 g = 10.000 kcal. Jetzt: max 2 Portionen = 200 g.
    expect(entry.computed.kcal).toBe(200)
    expect(entry.computed.kcal).toBeLessThan(10_000)
  })

  it('rechnet Portionen über die gemerkte defaultPortion um (Review-Pfad: Food aus createFood-Upsert)', async () => {
    const seeded = await createFood({ name: 'Skyr', per: 'g', kcal: 60, protein: 11, carbs: 4, fat: 0.2 })
    await logFood({ food: seeded, date: '2026-07-04', meal: 'breakfast', amount: 150, unit: 'g' }) // merkt defaultPortion 150 g
    // Wie im Review-confirm: createFood-Upsert liefert den Katalog-Stand inkl. defaultPortion.
    const food = await createFood({ name: 'Skyr', per: 'g', kcal: 60, protein: 11, carbs: 4, fat: 0.2, source: 'ai' })
    expect(food.defaultPortion).toEqual({ amount: 150, unit: 'g' })
    const entry = await logFood({ food, date: '2026-07-05', meal: 'breakfast', amount: 2, unit: 'portion' })
    // 2 Portionen × 150 g = 300 g → Faktor 3.
    expect(entry.computed.kcal).toBe(180)
    expect(entry.computed.protein).toBe(33)
  })
})

describe('Review-Lernschleife: Katalog-Match beim Übernehmen', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('findFoodByName matcht case-insensitiv/getrimmt und liefert die defaultPortion', async () => {
    const food = await createFood({ name: 'Skyr Natur', per: 'g', kcal: 63, protein: 11, carbs: 4, fat: 0.2 })
    await logFood({ food, date: '2026-07-04', meal: 'snack', amount: 150, unit: 'g' })

    const match = await findFoodByName('  sKyR nAtUr ')
    expect(match?.id).toBe(food.id)
    // Vorausfüll-Quelle für den Prüf-Screen:
    expect(match?.defaultPortion).toEqual({ amount: 150, unit: 'g' })

    expect(await findFoodByName('gibt es nicht')).toBeUndefined()
    expect(await findFoodByName('   ')).toBeUndefined()
  })

  it('Übernehmen-Pfad matcht den Katalog-Treffer statt ein Duplikat anzulegen — KI überschreibt gepflegte Werte NICHT (Befund 6)', async () => {
    // Bekanntes, manuell gepflegtes Produkt mit gemerkter Portion …
    const known = await createFood({ name: 'Haferflocken', per: 'g', kcal: 370, protein: 13, carbs: 59, fat: 7 })
    await logFood({ food: known, date: '2026-07-04', meal: 'breakfast', amount: 50, unit: 'g' })

    // … KI erkennt dasselbe Lebensmittel (andere Schreibweise, leicht andere Schätzwerte).
    const fromReview = await createFood({ name: 'haferflocken', per: 'g', kcal: 372, protein: 13.5, carbs: 58, fat: 7, source: 'ai' })

    // Kein Duplikat — der Log-Pfad nutzt den Bestands-Datensatz …
    expect(fromReview.id).toBe(known.id)
    expect(await db.foods.filter((f) => !f.deletedAt).count()).toBe(1)
    // … und zwar mit den GEPFLEGTEN Werten: Quellen-Hierarchie manual > ai,
    // die KI-Schätzung überschreibt den Katalog-Treffer nicht mehr.
    expect(fromReview).toMatchObject({ kcal: 370, protein: 13, source: 'manual' })
    const stored = await db.foods.get(known.id)
    expect(stored).toMatchObject({ kcal: 370, protein: 13, source: 'manual' })
    expect(stored!.defaultPortion).toEqual({ amount: 50, unit: 'g' })
  })

  it('Übernehmen-Pfad aktualisiert ein KI-Item weiterhin (ai über ai)', async () => {
    const known = await createFood({ name: 'Haferflocken', per: 'g', kcal: 370, protein: 13, carbs: 59, fat: 7, source: 'ai' })
    await logFood({ food: known, date: '2026-07-04', meal: 'breakfast', amount: 50, unit: 'g' })

    const fromReview = await createFood({ name: 'haferflocken', per: 'g', kcal: 372, protein: 13.5, carbs: 58, fat: 7, source: 'ai' })

    expect(fromReview.id).toBe(known.id)
    const stored = await db.foods.get(known.id)
    expect(stored).toMatchObject({ kcal: 372, protein: 13.5 })
    expect(stored!.defaultPortion).toEqual({ amount: 50, unit: 'g' })
  })

  it('gelöschte Katalog-Einträge werden nicht vorausgefüllt', async () => {
    const food = await createFood({ name: 'Apfel', per: 'g', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 })
    await db.foods.update(food.id, { deletedAt: Date.now() })
    expect(await findFoodByName('Apfel')).toBeUndefined()
  })
})
