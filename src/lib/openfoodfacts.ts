import type { NewFoodInput } from '@/db/repo'
import { ApiError, isOffline } from './apiError'
import { microsFromOff } from './nutrients'

/**
 * Open-Food-Facts-Lookup per Barcode (PLAN.md §3). Kein API-Key nötig, daher
 * direkt aus dem Client. Liefert Nährwerte je 100 g/ml + Allergene.
 */
export interface OffProduct {
  food: NewFoodInput & { barcode: string }
  allergens: string[]
  traces: string[]
}

interface OffRaw {
  status: number
  product?: {
    product_name?: string
    nutriments?: Record<string, number | undefined>
    allergens_tags?: string[]
    traces_tags?: string[]
    serving_quantity?: number
  }
}

const BASE = 'https://world.openfoodfacts.org/api/v2/product'

/**
 * `null` = Produkt nicht gefunden (weiterscannen sinnvoll). Netz-/Serverfehler
 * werfen einen typisierten ApiError (OFFLINE/UPSTREAM_ERROR) für die UI-Schicht.
 */
export async function lookupBarcode(barcode: string): Promise<OffProduct | null> {
  if (isOffline()) throw new ApiError('OFFLINE')
  const res = await fetch(`${BASE}/${encodeURIComponent(barcode)}.json`)
  if (res.status === 404) return null
  if (!res.ok) throw new ApiError('UPSTREAM_ERROR')
  let data: OffRaw
  try {
    data = (await res.json()) as OffRaw
  } catch {
    throw new ApiError('UPSTREAM_ERROR')
  }
  if (data.status !== 1 || !data.product) return null
  return mapProduct(barcode, data.product)
}

export function mapProduct(barcode: string, p: NonNullable<OffRaw['product']>): OffProduct | null {
  const n = p.nutriments ?? {}
  const kcal = n['energy-kcal_100g']
  if (p.product_name == null && kcal == null) return null
  const allergens = (p.allergens_tags ?? []).map((a) => a.replace(/^en:/, ''))
  const traces = (p.traces_tags ?? []).map((a) => a.replace(/^en:/, ''))
  return {
    food: {
      // Kein Anzeige-Text hier: leerer Name wird in der UI-Schicht über
      // i18n (capture.unknownProduct) ersetzt.
      name: p.product_name?.trim() ?? '',
      per: 'g',
      kcal: Math.round(kcal ?? 0),
      protein: round1(n['proteins_100g'] ?? 0),
      carbs: round1(n['carbohydrates_100g'] ?? 0),
      fat: round1(n['fat_100g'] ?? 0),
      micros: microsFromOff(n),
      allergens,
      traces,
      source: 'openfoodfacts',
      barcode,
    },
    allergens,
    traces,
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
