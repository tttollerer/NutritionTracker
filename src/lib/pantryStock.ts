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
  if (!food.pantry && by === 1) {
    // Frisch mit genau 1 Packung in den Vorrat: Zähler weglassen (Konvention
    // undefined == 1, wie addToPantry). So bleibt für den Undo unterscheidbar,
    // ob vorher eine leere Packung (explizites qty 0) im Vorrat lag oder keine.
    await db.foods.update(foodId, { pantry: true, updatedAt: now() })
    return
  }
  await setPantryQty(foodId, effectivePantryQty(food) + by)
}

/**
 * Beim Verzehr aus dem Vorrat eine Packung abziehen. Bei 0 bleibt pantry=true
 * (qty 0 = „leer" → taucht in lowPantryFoods/Einkaufsvorschlägen auf, statt zu
 * verschwinden). Gibt zurück, ob wirklich abgezogen wurde — der Aufrufer legt
 * beim Undo nur dann eine Packung zurück (leere Packung bleibt leer).
 */
export async function decrementPantryOnLog(foodId: string): Promise<boolean> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt || !food.pantry) return false
  const qty = effectivePantryQty(food)
  if (qty <= 0) return false
  await setPantryQty(foodId, qty - 1)
  return true
}

/**
 * Undo eines addToPantry/incrementPantry: `by` Packungen zurücknehmen und den
 * VORHER-Zustand wiederherstellen. Ein expliziter Zähler heißt, das Food lag
 * schon vor dem Add (ggf. „leer", qty 0) im Vorrat — dann bleibt es mit qty 0
 * Nachkauf-Kandidat. Ohne Zähler kam es erst durchs Add hinein: Flag UND
 * Zähler verschwinden ganz (Dexie entfernt undefined-Properties — sync-sauber
 * wie setPantry(false)).
 */
export async function undoPantryAdd(foodId: string, by = 1): Promise<void> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt || !food.pantry) return
  const rest = effectivePantryQty(food) - by
  if (rest >= 1) {
    // Rest 1 als undefined (Konvention == 1): erhält die Unterscheidung
    // „expliziter Zähler = lag vorher schon im Vorrat" für einen weiteren Undo.
    await db.foods.update(foodId, { pantryQty: rest > 1 ? rest : undefined, updatedAt: now() })
  } else if (food.pantryQty != null) {
    await db.foods.update(foodId, { pantryQty: 0, updatedAt: now() })
  } else {
    await db.foods.update(foodId, { pantry: undefined, pantryQty: undefined, updatedAt: now() })
  }
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

/** Gemeinsames „läuft bald ab"-Fenster (Tage) für Badge, Filter & Hinweis. */
export const EXPIRY_SOON_DAYS = 3

/** Tage bis zum MHD: 0 = heute, negativ = abgelaufen. UTC-Rechnung — DST-sicher. */
export function daysUntilExpiry(expiryDate: string, today = todayKey()): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(expiryDate) - utc(today)) / 86_400_000)
}

/**
 * Synchroner Einzel-Check (Zeilen-Badge/Filter) mit derselben Regel wie
 * expiringSoon(): MHD im Fenster (abgelaufene inklusive), leere Packungen nicht.
 */
export function isExpiringSoon(
  food: Pick<FoodItem, 'pantry' | 'pantryQty' | 'expiryDate'>,
  days = EXPIRY_SOON_DAYS,
  today = todayKey(),
): boolean {
  return (
    !!food.pantry &&
    (food.pantryQty ?? 1) > 0 &&
    !!food.expiryDate &&
    daysUntilExpiry(food.expiryDate, today) <= days
  )
}

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
export async function expiringSoon(days = EXPIRY_SOON_DAYS, today = todayKey()): Promise<FoodItem[]> {
  const foods = await db.foods
    .filter((f) => !f.deletedAt && isExpiringSoon(f, days, today))
    .toArray()
  return foods.sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))
}
