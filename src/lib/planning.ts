import { v4 as uuid } from 'uuid'
import { db } from '@/db'
import type { FoodItem, LogEntry, Meal, ShoppingItem, Unit } from '@/db/types'
import { computeCost, computeLogValues } from '@/db/repo'
import { addShoppingItem, openShoppingItems } from './shopping'

/**
 * Wochenplaner: geplante Mahlzeiten sind normale LogEntries mit planned=true.
 * Sie zählen NIRGENDS als Verzehr (zentral gefiltert wie deletedAt, siehe
 * sumsByDate/sumCost) — erst confirmPlanned() macht daraus einen echten Log.
 * Fokussierte lib-Datei nach dem Muster von src/lib/foodEdit.ts.
 */

const now = () => Date.now()

/** Mahlzeit für einen (zukünftigen) Tag vorplanen — erzeugt einen planned-Log. */
export async function planFood(args: {
  food: FoodItem
  date: string
  meal: Meal
  amount: number
  unit: Unit
}): Promise<LogEntry> {
  const { food, date, meal, amount, unit } = args
  const entry: LogEntry = {
    id: uuid(),
    foodId: food.id,
    date,
    meal,
    loggedAt: now(),
    amount,
    unit,
    computed: computeLogValues(food, amount, unit),
    cost: computeCost(food, amount, unit),
    planned: true,
    updatedAt: now(),
  }
  if (entry.cost === undefined) delete entry.cost // kein Leer-Feld persistieren
  await db.logs.put(entry)
  return entry
}

/**
 * Geplante Mahlzeit als gegessen bestätigen: planned-Flag entfernen, loggedAt
 * frisch setzen und computed/cost aus dem AKTUELLEN FoodItem neu berechnen
 * (das Food kann sich seit der Planung geändert haben). Gibt den bestätigten
 * Eintrag zurück (undefined, wenn er fehlt/gelöscht/nicht geplant ist).
 */
export async function confirmPlanned(logId: string): Promise<LogEntry | undefined> {
  return db.transaction('rw', db.logs, db.foods, async () => {
    const entry = await db.logs.get(logId)
    if (!entry || entry.deletedAt || !entry.planned) return undefined
    const food = await db.foods.get(entry.foodId)
    const confirmed: LogEntry = {
      ...entry,
      loggedAt: now(),
      // Ohne Food (sollte nicht vorkommen) bleibt der Plan-Snapshot stehen.
      computed: food ? computeLogValues(food, entry.amount, entry.unit) : entry.computed,
      cost: food ? computeCost(food, entry.amount, entry.unit) : entry.cost,
      updatedAt: now(),
    }
    delete confirmed.planned // Feld ganz entfernen (sync-sauber, wie favorite/pantry)
    if (confirmed.cost === undefined) delete confirmed.cost
    await db.logs.put(confirmed)
    return confirmed
  })
}

/** Geplante (nicht gelöschte) Einträge eines Tages, in Mahlzeiten-Reihenfolge stabil. */
export async function plannedForDate(date: string): Promise<LogEntry[]> {
  const entries = await db.logs
    .where('date')
    .equals(date)
    .filter((l) => !l.deletedAt && !!l.planned)
    .toArray()
  return entries.sort((a, b) => a.loggedAt - b.loggedAt)
}

/**
 * Fehlende Zutaten eines Plan-Tags: Foods der geplanten Einträge, die nicht
 * im Vorrat sind (pantry fehlt) oder deren Packung leer ist (pantryQty 0) —
 * Kandidaten für die Einkaufsliste (source 'plan'). Ohne Duplikate.
 */
export async function missingForPlan(date: string): Promise<FoodItem[]> {
  const planned = await plannedForDate(date)
  const ids = [...new Set(planned.map((l) => l.foodId))]
  if (ids.length === 0) return []
  const foods = await db.foods.bulkGet(ids)
  return foods.filter(
    (f): f is FoodItem => !!f && !f.deletedAt && (!f.pantry || (f.pantryQty ?? 1) <= 0),
  )
}

/**
 * Kosten-Snapshot-Summe geplanter Einträge in EUR (Panel-Fußzeile
 * „geplant: ~X €"). Gegenstück zu sumCost, das planned bewusst ausschließt.
 */
export function sumPlannedCost(
  logs: Pick<LogEntry, 'cost' | 'deletedAt' | 'planned'>[],
): number {
  const sum = logs.reduce((a, l) => a + (!l.deletedAt && l.planned ? l.cost ?? 0 : 0), 0)
  return Math.round(sum * 100) / 100 // Cent-genau gegen Float-Drift
}

/**
 * Fehlende Plan-Zutaten (missingForPlan) als 'plan'-Einträge auf die
 * Einkaufsliste setzen. Foods mit offenem Listen-Eintrag (per foodId) werden
 * übersprungen — keine Duplikate, wie suggestFromLowPantry. Gibt die neu
 * angelegten Einträge zurück (Basis für den Undo-Toast).
 */
export async function missingToShoppingList(date: string): Promise<ShoppingItem[]> {
  const [missing, open] = await Promise.all([missingForPlan(date), openShoppingItems()])
  const listed = new Set(open.flatMap((i) => (i.foodId ? [i.foodId] : [])))
  const created: ShoppingItem[] = []
  for (const food of missing) {
    if (listed.has(food.id)) continue
    created.push(await addShoppingItem({ name: food.name, foodId: food.id, qty: 1, source: 'plan' }))
  }
  return created
}
