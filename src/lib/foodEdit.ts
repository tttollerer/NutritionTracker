import { v4 as uuid } from 'uuid'
import { db } from '@/db'
import type { FoodItem, Micros, Photo, Unit } from '@/db/types'

/**
 * Produkt-Editor (Paket B): Schreibfunktionen für das Bearbeiten von
 * FoodItems + deren Produktfotos. Bewusst NICHT in src/db/repo.ts (parallel
 * belegt) — direkter db-Import nach dem Muster von src/lib/challenges.ts.
 *
 * Fotos liegen in der bestehenden `photos`-Tabelle (Data-URLs); das FoodItem
 * referenziert sie über das additive Feld `photoIds` (Reihenfolge = Anzeige).
 * Gelöscht wird per Tombstone (deletedAt), sync-sauber wie überall im Modell.
 */

const now = () => Date.now()

/** Nährwert-relevante Felder: Änderung ⇒ source wird 'manual' (Nutzer hat korrigiert). */
export interface FoodValuesPatch {
  name?: string
  per?: 'g' | 'ml'
  kcal?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  sugar?: number
  micros?: Micros
  /** `null` entfernt die gemerkte Portion, `undefined` lässt sie unverändert. */
  defaultPortion?: { amount: number; unit: Unit; label?: string } | null
  /** `null` entfernt den Packungspreis, `undefined` lässt ihn unverändert. */
  price?: { amount: number; per: number } | null
}

const NUTRIENT_KEYS = ['per', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'micros'] as const

/**
 * Werte eines Produkts aktualisieren. Ändert der Patch tatsächlich einen
 * Nährwert (per/kcal/Makros/fiber/sugar/micros), wird `source: 'manual'`
 * gesetzt — der Nutzer hat die KI-/DB-Werte überschrieben. Reine Namens-,
 * Portions- oder Preisänderungen lassen die Quelle unangetastet.
 */
export async function updateFoodValues(id: string, patch: FoodValuesPatch): Promise<FoodItem> {
  const food = await db.foods.get(id)
  if (!food || food.deletedAt) throw new Error(`FoodItem ${id} nicht gefunden`)

  const updated: FoodItem = { ...food }

  if (patch.name !== undefined && patch.name.trim()) updated.name = patch.name.trim()
  for (const k of ['per', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar'] as const) {
    const v = patch[k]
    if (v !== undefined) (updated as unknown as Record<string, unknown>)[k] = v
  }
  if (patch.micros !== undefined) {
    if (Object.keys(patch.micros).length) updated.micros = patch.micros
    else delete updated.micros
  }
  if (patch.defaultPortion !== undefined) {
    if (patch.defaultPortion) updated.defaultPortion = patch.defaultPortion
    else delete updated.defaultPortion
  }
  if (patch.price !== undefined) {
    if (patch.price) updated.price = patch.price
    else delete updated.price
  }

  const nutrientsChanged = NUTRIENT_KEYS.some(
    (k) => JSON.stringify(updated[k] ?? null) !== JSON.stringify(food[k] ?? null),
  )
  if (nutrientsChanged) updated.source = 'manual'
  updated.updatedAt = now()

  await db.foods.put(updated)
  return updated
}

/** Produktfoto (Data-URL, bereits verkleinert) anlegen und ans Produkt hängen. */
export async function addFoodPhoto(foodId: string, dataUrl: string): Promise<string> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt) throw new Error(`FoodItem ${foodId} nicht gefunden`)

  const photoId = uuid()
  const t = now()
  await db.photos.put({ id: photoId, dataUrl, createdAt: t, updatedAt: t })
  await db.foods.put({ ...food, photoIds: [...(food.photoIds ?? []), photoId], updatedAt: t })
  return photoId
}

/** Produktfoto entfernen: Tombstone auf der Photo-Zeile + Referenz aus photoIds. */
export async function removeFoodPhoto(foodId: string, photoId: string): Promise<void> {
  const food = await db.foods.get(foodId)
  const t = now()
  await db.photos.update(photoId, { deletedAt: t, updatedAt: t })
  if (!food) return
  const rest = (food.photoIds ?? []).filter((id) => id !== photoId)
  const next: FoodItem = { ...food, updatedAt: t }
  if (rest.length) next.photoIds = rest
  else delete next.photoIds
  await db.foods.put(next)
}

/** Produktfotos in photoIds-Reihenfolge (ohne gelöschte). */
export async function getFoodPhotos(foodId: string): Promise<Photo[]> {
  const food = await db.foods.get(foodId)
  const ids = food?.photoIds ?? []
  if (ids.length === 0) return []
  const rows = await db.photos.bulkGet(ids)
  return rows.filter((p): p is Photo => !!p && !p.deletedAt)
}
