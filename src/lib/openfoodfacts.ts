import type { NewFoodInput } from '@/db/repo'
import { microsFromOff } from './nutrients'

/**
 * Open-Food-Facts-Lookup per Barcode (PLAN.md §3). Kein API-Key nötig, daher
 * direkt aus dem Client. Liefert Nährwerte je 100 g/ml + Allergene.
 */
export interface OffProduct {
  food: NewFoodInput & { barcode: string }
  allergens: string[]
}

interface OffRaw {
  status: number
  product?: {
    product_name?: string
    nutriments?: Record<string, number | undefined>
    allergens_tags?: string[]
    serving_quantity?: number
  }
}

const BASE = 'https://world.openfoodfacts.org/api/v2/product'

export async function lookupBarcode(barcode: string): Promise<OffProduct | null> {
  const res = await fetch(`${BASE}/${encodeURIComponent(barcode)}.json`)
  if (!res.ok) return null
  const data = (await res.json()) as OffRaw
  if (data.status !== 1 || !data.product) return null
  return mapProduct(barcode, data.product)
}

export function mapProduct(barcode: string, p: NonNullable<OffRaw['product']>): OffProduct | null {
  const n = p.nutriments ?? {}
  const kcal = n['energy-kcal_100g']
  if (p.product_name == null && kcal == null) return null
  return {
    food: {
      name: p.product_name?.trim() || 'Unbekanntes Produkt',
      per: 'g',
      kcal: Math.round(kcal ?? 0),
      protein: round1(n['proteins_100g'] ?? 0),
      carbs: round1(n['carbohydrates_100g'] ?? 0),
      fat: round1(n['fat_100g'] ?? 0),
      micros: microsFromOff(n),
      source: 'openfoodfacts',
      barcode,
    },
    allergens: (p.allergens_tags ?? []).map((a) => a.replace(/^en:/, '')),
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
