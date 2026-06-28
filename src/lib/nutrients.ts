/**
 * Kanonischer Nährstoff-Katalog (PLAN.md §2 "KI erkennt, DB rechnet").
 * - kind 'benefit'  → Tagesziel erreichen (min)
 * - kind 'limit'    → unter Tagesgrenze bleiben (max), inkl. "Laster"
 *   (Zucker, Salz/Natrium, Koffein, Alkohol)
 *
 * Werte werden je 100 g/ml gespeichert (FoodItem.micros) und beim Loggen
 * skaliert (LogEntry.computed.micros). Open-Food-Facts liefert Mineralien in
 * Gramm — `offFactor` rechnet auf unsere Einheit um.
 */
export type NutrientKind = 'benefit' | 'limit'

export interface NutrientDef {
  key: string
  unit: string
  kind: NutrientKind
  /** Tages-Referenz: Zielwert (benefit) bzw. Obergrenze (limit) für Erwachsene. */
  ref: number
  /** Open-Food-Facts-Nutriment-Key (je 100 g) und Faktor auf unsere Einheit. */
  off?: { key: string; factor: number }
}

export const NUTRIENTS: NutrientDef[] = [
  // Benefit / Mikronährstoffe
  { key: 'fiber', unit: 'g', kind: 'benefit', ref: 30, off: { key: 'fiber_100g', factor: 1 } },
  { key: 'iron', unit: 'mg', kind: 'benefit', ref: 12, off: { key: 'iron_100g', factor: 1000 } },
  { key: 'calcium', unit: 'mg', kind: 'benefit', ref: 1000, off: { key: 'calcium_100g', factor: 1000 } },
  { key: 'magnesium', unit: 'mg', kind: 'benefit', ref: 350, off: { key: 'magnesium_100g', factor: 1000 } },
  { key: 'zinc', unit: 'mg', kind: 'benefit', ref: 10, off: { key: 'zinc_100g', factor: 1000 } },
  { key: 'potassium', unit: 'mg', kind: 'benefit', ref: 3500, off: { key: 'potassium_100g', factor: 1000 } },
  { key: 'vitaminC', unit: 'mg', kind: 'benefit', ref: 95, off: { key: 'vitamin-c_100g', factor: 1000 } },
  { key: 'vitaminD', unit: 'µg', kind: 'benefit', ref: 20, off: { key: 'vitamin-d_100g', factor: 1_000_000 } },
  { key: 'vitaminB12', unit: 'µg', kind: 'benefit', ref: 4, off: { key: 'vitamin-b12_100g', factor: 1_000_000 } },
  { key: 'omega3', unit: 'g', kind: 'benefit', ref: 1.5, off: { key: 'omega-3-fat_100g', factor: 1 } },
  // Limit / "Laster"
  { key: 'sugar', unit: 'g', kind: 'limit', ref: 50, off: { key: 'sugars_100g', factor: 1 } },
  { key: 'satFat', unit: 'g', kind: 'limit', ref: 20, off: { key: 'saturated-fat_100g', factor: 1 } },
  { key: 'sodium', unit: 'mg', kind: 'limit', ref: 2300, off: { key: 'sodium_100g', factor: 1000 } },
  { key: 'caffeine', unit: 'mg', kind: 'limit', ref: 400, off: { key: 'caffeine_100g', factor: 1000 } },
  { key: 'alcohol', unit: 'g', kind: 'limit', ref: 10, off: { key: 'alcohol_100g', factor: 1 } },
]

export const NUTRIENT_BY_KEY: Record<string, NutrientDef> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n]),
)

export const BENEFIT_KEYS = NUTRIENTS.filter((n) => n.kind === 'benefit').map((n) => n.key)
export const LIMIT_KEYS = NUTRIENTS.filter((n) => n.kind === 'limit').map((n) => n.key)

/** Mikronährstoffe aus den OFF-Nutriments extrahieren (je 100 g, in unseren Einheiten). */
export function microsFromOff(nutriments: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of NUTRIENTS) {
    if (!n.off) continue
    const raw = nutriments[n.off.key]
    if (typeof raw === 'number' && raw > 0) out[n.key] = round2(raw * n.off.factor)
  }
  return out
}

/**
 * Referenzziel je Nährstoff, leicht profilabhängig:
 * - Eisen für menstruierende Frauen und Veganer höher,
 * - B12 für Veganer als striktes Minimum.
 */
export function nutrientTarget(def: NutrientDef, opts?: { sex?: 'm' | 'f'; vegan?: boolean }): number {
  let ref = def.ref
  if (def.key === 'iron') {
    if (opts?.sex === 'f') ref = 15
    if (opts?.vegan) ref *= 1.8
  }
  return Math.round(ref)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
