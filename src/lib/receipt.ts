import { db } from '@/db'
import type { FoodItem } from '@/db/types'
import type { ReceiptItem } from './apiContract'
import { addToPantry, findFoodByName, setFoodPrice } from '@/db/repo'
import { incrementPantry } from './pantryStock'

/**
 * Kassenbon-Scan (Vertrag v1.3): Zwischenspeicher der erkannten Positionen für
 * den Prüf-Screen (/receipt) + Übernahme in den Vorrat. Fokussierte lib-Datei
 * nach dem Muster von src/lib/pantryStock.ts.
 */

// ---- Zwischenspeicher (sessionStorage, Muster reviewStore) ----

const KEY = 'nt-receipt'

export function setReceiptDraft(items: ReceiptItem[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ items }))
  } catch {
    // Flüchtiger Arbeitszustand — volle Quota darf den Flow nicht crashen.
  }
}

export function getReceiptDraft(): ReceiptItem[] | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { items?: ReceiptItem[] }
    return Array.isArray(parsed.items) ? parsed.items : null
  } catch {
    return null
  }
}

export function clearReceiptDraft(): void {
  sessionStorage.removeItem(KEY)
}

// ---- Übernahme in den Vorrat ----

/** Ergebnis je Position — `prevPantry` stellt der Undo exakt wieder her. */
export interface ReceiptSaveResult {
  food: FoodItem
  /** Hinzugekommene Packungen (Anzeige/Nachvollziehbarkeit). */
  added: number
  /** Vorrats-Zustand VOR der Übernahme — Basis für punktgenaues Undo. */
  prevPantry: Pick<FoodItem, 'pantry' | 'pantryQty'>
}

/**
 * Alle Bon-Positionen in den Vorrat („Alle in den Vorrat"):
 * - Ohne per100 und mit Katalog-Treffer wird das Bestands-Item NICHT angefasst
 *   (ein Bon kennt keine Nährwerte — gepflegte KI-/Label-Werte blieben sonst
 *   nicht vor dem Nullen sicher), nur der Bestand steigt um die Stückzahl.
 * - Sonst addToPantry-Upsert (Dedupe per Name, +1 Packung) + incrementPantry
 *   für die weiteren Stück.
 * - Ein Positionspreis wird als Packungspreis übernommen (setFoodPrice mit
 *   Historie): price ist der GESAMTpreis der Position → geteilt durch die
 *   Stückzahl. Die Packungsgröße steht nicht auf dem Bon — eine bestehende
 *   (price.per) bleibt erhalten, sonst Annahme 100 g/ml (im
 *   Lebensmittel-Detail korrigierbar).
 */
export async function saveReceiptToPantry(items: ReceiptItem[]): Promise<ReceiptSaveResult[]> {
  const out: ReceiptSaveResult[] = []
  for (const it of items) {
    const name = it.name.trim()
    if (!name) continue
    const qty = Math.max(1, Math.round(it.quantity))

    // Vorrats-Zustand VOR der Übernahme einfrieren (gleiche Match-Regel wie
    // der createFood-Namens-Dedupe) — undoReceiptSave stellt ihn exakt her.
    const match = await findFoodByName(name)
    const prevPantry = { pantry: match?.pantry, pantryQty: match?.pantryQty }
    const existing = it.per100 ? undefined : match
    let food: FoodItem
    if (existing) {
      await incrementPantry(existing.id, qty)
      food = (await db.foods.get(existing.id)) ?? existing
    } else {
      food = await addToPantry({
        name,
        per: 'g',
        kcal: it.per100?.kcal ?? 0,
        protein: it.per100?.protein ?? 0,
        carbs: it.per100?.carbs ?? 0,
        fat: it.per100?.fat ?? 0,
        source: 'ai',
      })
      if (qty > 1) {
        await incrementPantry(food.id, qty - 1)
        food = (await db.foods.get(food.id)) ?? food
      }
    }

    if (it.price != null && it.price > 0) {
      const perPack = Math.round((it.price / qty) * 100) / 100
      await setFoodPrice(food.id, { amount: perPack, per: food.price?.per ?? 100 })
      food = (await db.foods.get(food.id)) ?? food
    }

    out.push({ food, added: qty, prevPantry })
  }
  return out
}

/**
 * Undo der Übernahme: je Position den Vorrats-Zustand von VOR dem Bon exakt
 * wiederherstellen — Foods, die vorher nicht im Vorrat lagen, fliegen wieder
 * raus, „leer" gemerkte (qty 0) bleiben leer (Preis-Update bleibt — der alte
 * Preis liegt in der priceHistory). Rückwärts, damit bei doppelten Positionen
 * desselben Foods der Zustand vor der ERSTEN Position gewinnt.
 */
export async function undoReceiptSave(saved: ReceiptSaveResult[]): Promise<void> {
  for (const { food, prevPantry } of [...saved].reverse()) {
    await db.foods.update(food.id, {
      pantry: prevPantry.pantry || undefined,
      pantryQty: prevPantry.pantryQty,
      updatedAt: Date.now(),
    })
  }
}
