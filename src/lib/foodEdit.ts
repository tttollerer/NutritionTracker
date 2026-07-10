import { v4 as uuid } from 'uuid'
import { db } from '@/db'
import { PRICE_HISTORY_MAX } from '@/db/repo'
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
  /** Leerer String entfernt die Beschreibung, `undefined` lässt sie unverändert. */
  description?: string
  /** Leeres Array entfernt alle Tags, `undefined` lässt sie unverändert. */
  tags?: string[]
  /**
   * Benannte Portionseinheiten („Stück" = 22 g). Leeres Array entfernt alle,
   * `undefined` lässt sie unverändert. Labels werden getrimmt und (case-
   * insensitiv) dedupliziert, Einträge ohne positiven Wert verworfen.
   */
  servings?: { label: string; amount: number }[]
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
    // Abgelöste (geänderte/entfernte) Preise wandern wie bei setFoodPrice in
    // die priceHistory — der Editor ist sonst der einzige Preis-Pfad ohne Verlauf.
    const old = food.price
    const changed =
      old && (!patch.price || old.amount !== patch.price.amount || old.per !== patch.price.per)
    if (changed) {
      updated.priceHistory = [{ ...old, at: now() }, ...(food.priceHistory ?? [])].slice(
        0,
        PRICE_HISTORY_MAX,
      )
    }
    if (patch.price) updated.price = patch.price
    else delete updated.price
  }
  // Beschreibung & Tags (Lebensmittel-Detail): rein beschreibende Felder,
  // ändern die Quelle NICHT (analog Name/Portion/Preis).
  if (patch.description !== undefined) {
    const text = patch.description.trim()
    if (text) updated.description = text
    else delete updated.description
  }
  if (patch.tags !== undefined) {
    const tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))]
    if (tags.length) updated.tags = tags
    else delete updated.tags
  }
  if (patch.servings !== undefined) {
    const seen = new Set<string>()
    const servings = patch.servings.flatMap((s) => {
      const label = s.label.trim()
      const key = label.toLowerCase()
      if (!label || !(s.amount > 0) || seen.has(key)) return []
      seen.add(key)
      return [{ label, amount: s.amount }]
    })
    if (servings.length) updated.servings = servings
    else delete updated.servings
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
