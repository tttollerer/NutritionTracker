import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import type { FoodItem, LogEntry } from '@/db/types'
import { budgetProgress, costsByTag, getWeeklyBudget, kcalPrice, proteinPricePerFood, setWeeklyBudget, topCostTags, UNTAGGED } from './budget'

const food = (over: Partial<FoodItem>): FoodItem => ({
  id: over.id ?? 'f',
  name: over.name ?? 'Food',
  source: 'manual',
  per: 'g',
  kcal: 100,
  protein: 10,
  carbs: 10,
  fat: 2,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const log = (over: Partial<LogEntry>): LogEntry => ({
  id: over.id ?? 'l',
  foodId: over.foodId ?? 'f',
  date: '2026-07-10',
  meal: 'lunch',
  loggedAt: 0,
  amount: 100,
  unit: 'g',
  computed: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  updatedAt: 0,
  ...over,
})

describe('Wochenbudget (Settings)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('setWeeklyBudget speichert, rundet auf Cent und entfernt mit undefined', async () => {
    expect(await getWeeklyBudget()).toBeUndefined()

    await setWeeklyBudget(60.999)
    expect(await getWeeklyBudget()).toBe(61)

    await setWeeklyBudget(undefined)
    expect(await getWeeklyBudget()).toBeUndefined()

    // Ungültige Werte (0/negativ) entfernen das Budget statt Unsinn zu speichern.
    await setWeeklyBudget(45)
    await setWeeklyBudget(0)
    expect(await getWeeklyBudget()).toBeUndefined()
  })
})

describe('Kosten- & Preis-Auswertungen (pure)', () => {
  it('costsByTag summiert je erstem Tag; ohne Tags → UNTAGGED; planned/deleted zählen nicht', () => {
    const foods = [
      food({ id: 'milk', tags: ['Milchprodukt', 'Frühstück'] }),
      food({ id: 'rice', tags: ['Grundnahrung'] }),
      food({ id: 'apple' }),
    ]
    const logs = [
      log({ id: '1', foodId: 'milk', cost: 1.2 }),
      log({ id: '2', foodId: 'milk', cost: 0.8 }),
      log({ id: '3', foodId: 'rice', cost: 0.5 }),
      log({ id: '4', foodId: 'apple', cost: 0.3 }),
      log({ id: '5', foodId: 'rice', cost: 9, planned: true }), // nur geplant
      log({ id: '6', foodId: 'rice', cost: 9, deletedAt: 1 }), // gelöscht
      log({ id: '7', foodId: 'rice' }), // ohne Kosten-Snapshot
    ]
    expect(costsByTag(logs, foods)).toEqual({
      Milchprodukt: 2,
      Grundnahrung: 0.5,
      [UNTAGGED]: 0.3,
    })
  })

  it('budgetProgress: Anteil geklemmt, over-Flag und Abstand in EUR', () => {
    // Ohne (gültiges) Budget keine Auswertung.
    expect(budgetProgress(10)).toBeUndefined()
    expect(budgetProgress(10, 0)).toBeUndefined()

    expect(budgetProgress(30, 60)).toEqual({ ratio: 0.5, over: false, diff: 30 })
    // Über Budget: Balken bleibt bei 100 %, diff ist die Überschreitung.
    expect(budgetProgress(75.5, 60)).toEqual({ ratio: 1, over: true, diff: 15.5 })
    // Punktlandung zählt nicht als „drüber".
    expect(budgetProgress(60, 60)).toEqual({ ratio: 1, over: false, diff: 0 })
  })

  it('topCostTags: teuerste Kategorien zuerst, auf n begrenzt', () => {
    const costs = { Obst: 2, Fleisch: 9, Milchprodukt: 5, Brot: 1 }
    expect(topCostTags(costs, 2)).toEqual([
      ['Fleisch', 9],
      ['Milchprodukt', 5],
    ])
    expect(topCostTags({})).toEqual([])
  })

  it('proteinPricePerFood: €/100 g Protein, nur mit Preis & Protein, günstigste zuerst', () => {
    const skyr = food({ id: 'skyr', protein: 11, price: { amount: 1.1, per: 500 } })
    const whey = food({ id: 'whey', protein: 80, price: { amount: 20, per: 1000 } })
    const noPrice = food({ id: 'x', protein: 30 })
    const noProtein = food({ id: 'y', protein: 0, price: { amount: 1, per: 100 } })

    const ranked = proteinPricePerFood([skyr, whey, noPrice, noProtein])
    expect(ranked.map((r) => r.food.id)).toEqual(['skyr', 'whey'])
    // Skyr: 100 g Protein stecken in ~909 g → 909 g * 1,10 €/500 g = 2 €.
    expect(ranked[0].price).toBe(2)
    // Whey: 100 g Protein in 125 g → 125 g * 20 €/1000 g = 2,50 €.
    expect(ranked[1].price).toBe(2.5)
  })

  it('kcalPrice: €/1000 kcal, nur mit Preis & kcal', () => {
    const rice = food({ id: 'rice', kcal: 350, price: { amount: 2, per: 1000 } })
    const oil = food({ id: 'oil', kcal: 900, price: { amount: 3, per: 1000 } })
    const zero = food({ id: 'zero', kcal: 0, price: { amount: 1, per: 100 } })

    const ranked = kcalPrice([rice, oil, zero])
    expect(ranked.map((r) => r.food.id)).toEqual(['oil', 'rice'])
    // Öl: 1000 kcal in ~111 g → 0,33 €; Reis: 1000 kcal in ~286 g → 0,57 €.
    expect(ranked[0].price).toBe(0.33)
    expect(ranked[1].price).toBe(0.57)
  })
})
