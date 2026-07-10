import { v4 as uuid } from 'uuid'
import { db } from '@/db'
import type { ShoppingItem } from '@/db/types'
import { incrementPantry, lowPantryFoods } from './pantryStock'

/**
 * Einkaufsliste (eigene Tabelle, Dexie v6). Fokussierte lib-Datei nach dem
 * Muster von src/lib/foodEdit.ts. Löschen per Tombstone (deletedAt) —
 * sync-sauber wie überall im Modell.
 */

const now = () => Date.now()

export interface NewShoppingItemInput {
  name: string
  foodId?: string
  qty?: number
  note?: string
  source?: ShoppingItem['source']
}

/** Eintrag anlegen (Default-Quelle 'manual'). */
export async function addShoppingItem(input: NewShoppingItemInput): Promise<ShoppingItem> {
  const item: ShoppingItem = {
    id: uuid(),
    name: input.name.trim(),
    foodId: input.foodId,
    qty: input.qty,
    note: input.note?.trim() || undefined,
    source: input.source ?? 'manual',
    checked: false,
    updatedAt: now(),
  }
  await db.shoppingList.put(item)
  return item
}

/** Häkchen umschalten; gibt den neuen Zustand zurück. */
export async function toggleShoppingItem(id: string): Promise<boolean> {
  const item = await db.shoppingList.get(id)
  if (!item || item.deletedAt) return false
  const next = !item.checked
  await db.shoppingList.update(id, { checked: next, updatedAt: now() })
  return next
}

/** Eintrag entfernen (Soft-Delete, Undo-fähig). */
export async function removeShoppingItem(id: string): Promise<void> {
  await db.shoppingList.update(id, { deletedAt: now(), updatedAt: now() })
}

/** Offene (nicht abgehakte, nicht gelöschte) Einträge, neueste zuerst. */
export async function openShoppingItems(): Promise<ShoppingItem[]> {
  const items = await db.shoppingList.filter((i) => !i.deletedAt && !i.checked).toArray()
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Nachkauf-Vorschläge aus dem zur Neige gehenden Vorrat (lowPantryFoods) als
 * 'auto'-Einträge anlegen. Foods, die bereits als offener Eintrag auf der
 * Liste stehen (per foodId), werden übersprungen — keine Duplikate.
 * Gibt die neu angelegten Einträge zurück.
 */
export async function suggestFromLowPantry(): Promise<ShoppingItem[]> {
  const [low, open] = await Promise.all([lowPantryFoods(), openShoppingItems()])
  const listed = new Set(open.flatMap((i) => (i.foodId ? [i.foodId] : [])))
  const created: ShoppingItem[] = []
  for (const food of low) {
    if (listed.has(food.id)) continue
    created.push(await addShoppingItem({ name: food.name, foodId: food.id, qty: 1, source: 'auto' }))
  }
  return created
}

/**
 * Eintrag abhaken „in den Vorrat": Häkchen setzen und — falls mit dem Katalog
 * verknüpft — die gekauften Packungen (qty, Default 1) auf pantryQty addieren.
 */
export async function checkOffToPantry(itemId: string): Promise<void> {
  const item = await db.shoppingList.get(itemId)
  if (!item || item.deletedAt || item.checked) return
  await db.shoppingList.update(itemId, { checked: true, updatedAt: now() })
  if (item.foodId) await incrementPantry(item.foodId, item.qty ?? 1)
}
