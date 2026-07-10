import { v4 as uuid } from 'uuid'
import { db } from '@/db'
import type { FoodItem, LogEntry, Meal, Recipe, RecipeIngredient } from '@/db/types'
import { computeCost, computeLogValues } from '@/db/repo'
import { decrementPantryOnLog } from './pantryStock'

/**
 * Eigene Rezepte (eigene Tabelle, Dexie v6). Loggen eines Rezepts erzeugt EIN
 * LogEntry pro Zutat (skaliert auf die gegessenen Portionen) — so bleiben
 * Nährwert-/Kosten-Auswertungen und der Kosten-Snapshot identisch zu logFood.
 * Fokussierte lib-Datei nach dem Muster von src/lib/foodEdit.ts.
 */

const now = () => Date.now()

export interface NewRecipeInput {
  name: string
  portions: number
  ingredients: RecipeIngredient[]
  description?: string
}

export async function createRecipe(input: NewRecipeInput): Promise<Recipe> {
  const recipe: Recipe = {
    id: uuid(),
    name: input.name.trim(),
    portions: Math.max(1, Math.round(input.portions)),
    ingredients: input.ingredients,
    description: input.description?.trim() || undefined,
    updatedAt: now(),
  }
  await db.recipes.put(recipe)
  return recipe
}

export async function updateRecipe(
  id: string,
  patch: Partial<Omit<Recipe, 'id' | 'updatedAt' | 'deletedAt'>>,
): Promise<Recipe | undefined> {
  const recipe = await db.recipes.get(id)
  if (!recipe || recipe.deletedAt) return undefined
  const updated: Recipe = { ...recipe, ...patch, id, updatedAt: now() }
  if (patch.portions != null) updated.portions = Math.max(1, Math.round(patch.portions))
  await db.recipes.put(updated)
  return updated
}

/** Rezept löschen (Tombstone, sync-sauber). */
export async function deleteRecipe(id: string): Promise<void> {
  await db.recipes.update(id, { deletedAt: now(), updatedAt: now() })
}

/** Tombstone zurücknehmen (Undo nach Löschen). */
export async function restoreRecipe(id: string): Promise<void> {
  await db.recipes.update(id, { deletedAt: undefined, updatedAt: now() })
}

/** Alle (nicht gelöschten) Rezepte, alphabetisch. */
export async function listRecipes(): Promise<Recipe[]> {
  const recipes = await db.recipes.filter((r) => !r.deletedAt).toArray()
  return recipes.sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export interface LogRecipeResult {
  entries: LogEntry[]
  /** Food-IDs, bei denen eine Vorrats-Packung abging (Undo legt sie zurück). */
  pantryTook: string[]
}

/**
 * Rezept loggen: Zutatenmengen (fürs GANZE Rezept hinterlegt) werden auf
 * portionsEaten/portions skaliert, je Zutat entsteht ein LogEntry mit
 * computed- und Kosten-Snapshot (wie logFood). Zutaten ohne Katalog-Food
 * werden übersprungen (gelöschtes Food ⇒ Rezept-Rest bleibt loggbar).
 * Je geloggter Zutat geht eine Packung vom Vorrat ab — gleiche
 * Bestandsführung wie beim direkten Loggen (decrementPantryOnLog).
 * Gibt Einträge + Vorrats-Info zurück (Undo: Einträge löschen, Packungen zurück).
 */
export async function logRecipe(
  recipeId: string,
  args: { date: string; meal: Meal; portionsEaten: number },
): Promise<LogRecipeResult> {
  const recipe = await db.recipes.get(recipeId)
  if (!recipe || recipe.deletedAt) return { entries: [], pantryTook: [] }
  const factor = args.portionsEaten / recipe.portions
  const foods = await db.foods.bulkGet(recipe.ingredients.map((i) => i.foodId))

  const entries: LogEntry[] = []
  recipe.ingredients.forEach((ing, idx) => {
    const food = foods[idx]
    if (!food || food.deletedAt) return
    const amount = Math.round(ing.amount * factor * 10) / 10
    const entry: LogEntry = {
      id: uuid(),
      foodId: food.id,
      date: args.date,
      meal: args.meal,
      loggedAt: now(),
      amount,
      unit: ing.unit,
      computed: computeLogValues(food, amount, ing.unit),
      cost: computeCost(food, amount, ing.unit),
      updatedAt: now(),
    }
    if (entry.cost === undefined) delete entry.cost // kein Leer-Feld persistieren
    entries.push(entry)
  })
  const pantryTook: string[] = []
  if (entries.length) {
    await db.logs.bulkPut(entries)
    for (const e of entries) {
      if (await decrementPantryOnLog(e.foodId)) pantryTook.push(e.foodId)
    }
  }
  return { entries, pantryTook }
}

/**
 * Kosten (EUR) einer Portion aus den Packungspreisen der Zutaten — Zutaten
 * ohne Preis/Food zählen 0. undefined, wenn KEINE Zutat einen Preis hat
 * (Haushaltskasse strikt optional). Auf Cent gerundet.
 */
export function recipeCostPerPortion(
  recipe: Pick<Recipe, 'portions' | 'ingredients'>,
  foodsMap: Map<string, FoodItem>,
): number | undefined {
  let sum = 0
  let priced = false
  for (const ing of recipe.ingredients) {
    const food = foodsMap.get(ing.foodId)
    if (!food) continue
    const cost = computeCost(food, ing.amount, ing.unit)
    if (cost === undefined) continue
    priced = true
    sum += cost
  }
  if (!priced) return undefined
  return Math.round((sum / Math.max(1, recipe.portions)) * 100) / 100
}

/**
 * kcal einer Portion aus den Referenzwerten der Zutaten (gleiche Skalierung
 * wie beim Loggen). undefined, wenn keine Zutat (mehr) im Katalog ist.
 */
export function recipeKcalPerPortion(
  recipe: Pick<Recipe, 'portions' | 'ingredients'>,
  foodsMap: Map<string, FoodItem>,
): number | undefined {
  let sum = 0
  let any = false
  for (const ing of recipe.ingredients) {
    const food = foodsMap.get(ing.foodId)
    if (!food) continue
    any = true
    sum += computeLogValues(food, ing.amount, ing.unit).kcal
  }
  if (!any) return undefined
  return Math.round(sum / Math.max(1, recipe.portions))
}
