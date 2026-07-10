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
  /** Packungsgröße in g/ml (OFF product_quantity) — Vorbelegung für die Preis-Eingabe. */
  packageSize?: number
}

interface OffRaw {
  status: number
  product?: {
    product_name?: string
    nutriments?: Record<string, number | undefined>
    allergens_tags?: string[]
    traces_tags?: string[]
    serving_quantity?: number
    serving_size?: string
    product_quantity?: number | string
    product_quantity_unit?: string
    categories_tags?: string[]
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
      per: inferPer(p),
      kcal: Math.round(kcal ?? 0),
      protein: round1(n['proteins_100g'] ?? 0),
      carbs: round1(n['carbohydrates_100g'] ?? 0),
      fat: round1(n['fat_100g'] ?? 0),
      micros: microsFromOff(n),
      allergens,
      traces,
      source: 'openfoodfacts',
      barcode,
      servings: offServings(p),
    },
    allergens,
    traces,
    packageSize: packageSize(p.product_quantity),
  }
}

/**
 * Benannte Portionseinheiten aus den OFF-Angaben: Portionsgröße
 * (serving_quantity, z. B. Riegel/Glas) und Packungsgröße (product_quantity,
 * z. B. Dose/Flasche) — beide in der Basis-Einheit g/ml. Identische Werte
 * werden nicht doppelt angeboten; ohne verwertbare Angabe: undefined.
 */
export function offServings(
  p: Pick<NonNullable<OffRaw['product']>, 'serving_quantity' | 'product_quantity'>,
): { label: string; amount: number }[] | undefined {
  const out: { label: string; amount: number }[] = []
  const sq = Number(p.serving_quantity)
  if (Number.isFinite(sq) && sq > 0) out.push({ label: 'Portion', amount: sq })
  const pq = Number(p.product_quantity)
  if (Number.isFinite(pq) && pq > 0 && pq !== sq) out.push({ label: 'Packung', amount: pq })
  return out.length ? out : undefined
}

/** Einheiten, die eindeutig auf Flüssigkeit (Nährwerte je 100 ml) hindeuten. */
const LIQUID_UNITS = new Set(['ml', 'cl', 'dl', 'l', 'litre', 'liter', 'litres', 'liters'])
/** Einheiten, die eindeutig auf Festes (je 100 g) hindeuten. */
const SOLID_UNITS = new Set(['g', 'kg', 'mg', 'oz', 'lb'])

/**
 * Getränke nicht als Gramm führen (Audit-Befund 15): Bezugsgröße aus den
 * OFF-Daten ableiten — explizite Packungs-Einheit vor Portionsangabe vor
 * Getränke-Kategorien; ohne Signal bleibt der bisherige Fallback 'g'.
 */
export function inferPer(
  p: Pick<NonNullable<OffRaw['product']>, 'product_quantity_unit' | 'serving_size' | 'categories_tags'>,
): 'g' | 'ml' {
  const unit = p.product_quantity_unit?.trim().toLowerCase()
  if (unit) {
    if (LIQUID_UNITS.has(unit)) return 'ml'
    if (SOLID_UNITS.has(unit)) return 'g'
  }
  // Portionsangabe wie "330 ml" / "25 cl" bzw. "25 g".
  const serving = p.serving_size?.toLowerCase() ?? ''
  if (/\d\s*(ml|cl|dl|l)\b/.test(serving)) return 'ml'
  if (/\d\s*(g|kg)\b/.test(serving)) return 'g'
  if ((p.categories_tags ?? []).some(isBeverageTag)) return 'ml'
  return 'g'
}

/**
 * OFF-Kategorie-Tags, die Getränke markieren (en:beverages, en:sodas, …).
 * "…foods-and-beverages" ist eine Sammelkategorie, die auch feste Lebensmittel
 * enthält — sie zählt bewusst NICHT als Getränke-Signal.
 */
function isBeverageTag(tag: string): boolean {
  if (tag.endsWith('foods-and-beverages')) return false
  return /(beverages|drinks|juices|waters|sodas|smoothies)$/.test(tag)
}

/** OFF liefert product_quantity mal als Zahl, mal als String — nur positive Zahlen übernehmen. */
function packageSize(q: number | string | undefined): number | undefined {
  const n = typeof q === 'string' ? Number.parseFloat(q) : q
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
