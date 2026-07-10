import { db } from '@/db'
import type { FoodItem } from '@/db/types'
import { todayKey } from '@/lib/utils'

/**
 * Vorrats-Bestand & MHD (Ausbau von „Mein Vorrat"): Packungszähler auf
 * FoodItem.pantryQty + Haltbarkeit auf FoodItem.expiryDate. Bewusst NICHT in
 * src/db/repo.ts — fokussierte lib-Datei nach dem Muster von src/lib/foodEdit.ts.
 *
 * Konvention (siehe FoodItem.pantryQty): pantry=true + pantryQty undefined == 1
 * Packung; 0 heißt „leer" — das pantry-Flag bleibt dabei erhalten, damit das
 * Produkt als Nachkauf-Kandidat sichtbar bleibt.
 */

const now = () => Date.now()

/** Effektiver Packungsbestand eines Foods (Konvention: undefined == 1). */
export function effectivePantryQty(food: Pick<FoodItem, 'pantry' | 'pantryQty'>): number {
  if (!food.pantry) return 0
  return food.pantryQty ?? 1
}

/** Packungszahl direkt setzen; setzt dabei immer auch pantry=true. */
export async function setPantryQty(foodId: string, qty: number): Promise<void> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt) return
  const safe = Math.max(0, Math.round(qty))
  await db.foods.update(foodId, { pantry: true, pantryQty: safe, updatedAt: now() })
}

/** Packungen in den Vorrat legen (Einkauf abgehakt / nachgescannt). */
export async function incrementPantry(foodId: string, by = 1): Promise<void> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt) return
  await setPantryQty(foodId, effectivePantryQty(food) + by)
}

/**
 * Beim Loggen eine Packung abziehen. Bei 0 bleibt pantry=true (qty 0 = „leer"
 * → taucht in lowPantryFoods/Einkaufsvorschlägen auf, statt zu verschwinden).
 */
export async function decrementPantryOnLog(foodId: string): Promise<void> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt || !food.pantry) return
  await setPantryQty(foodId, Math.max(0, effectivePantryQty(food) - 1))
}

/** Vorrats-Foods, die zur Neige gehen (qty <= 1) — Basis für Einkaufsvorschläge. */
export async function lowPantryFoods(): Promise<FoodItem[]> {
  const foods = await db.foods
    .filter((f) => !f.deletedAt && !!f.pantry && (f.pantryQty ?? 1) <= 1)
    .toArray()
  // Leere Packungen (0) zuerst — dringendster Nachkauf oben.
  return foods.sort((a, b) => (a.pantryQty ?? 1) - (b.pantryQty ?? 1) || a.name.localeCompare(b.name, 'de'))
}

// ---- MHD (Mindesthaltbarkeitsdatum) ----

/** MHD der offenen Packung setzen oder mit `null` entfernen. */
export async function setExpiry(foodId: string, date: string | null): Promise<void> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt) return
  // Dexie entfernt Properties, die im update() auf undefined gesetzt werden.
  await db.foods.update(foodId, { expiryDate: date ?? undefined, updatedAt: now() })
}

/**
 * Vorrats-Foods, deren MHD in den nächsten `days` Tagen abläuft (bereits
 * abgelaufene inklusive — sie sind am dringendsten). Leere Packungen (qty 0)
 * fallen raus: kein Inhalt, kein Verderb. Aufsteigend nach Datum sortiert.
 */
export async function expiringSoon(days = 3, today = todayKey()): Promise<FoodItem[]> {
  const [y, m, d] = today.split('-').map(Number)
  const limit = todayKey(new Date(y, m - 1, d + days))
  const foods = await db.foods
    .filter(
      (f) =>
        !f.deletedAt &&
        !!f.pantry &&
        (f.pantryQty ?? 1) > 0 &&
        !!f.expiryDate &&
        f.expiryDate <= limit,
    )
    .toArray()
  return foods.sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))
}
