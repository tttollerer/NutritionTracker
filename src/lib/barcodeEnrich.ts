import type { AiResult } from './ai'
import { lookupBarcode, type OffProduct } from './openfoodfacts'

/**
 * Barcode-Anreicherung des Foto-Scans (Vertrag v1.4): Liest die KI einen
 * EAN/UPC vom Bild ab, holt der Client die EXAKTEN Produktdaten von
 * OpenFoodFacts — Datenbankwerte schlagen die KI-Schätzung. Der Lookup ist
 * strikt Bonus: schlägt er fehl (offline, unbekannter Code), bleibt das
 * KI-Ergebnis unverändert bestehen.
 */

export interface EnrichedAnalyze {
  items: AiResult['items']
  notes?: string
  questions?: string[]
  source: 'ai' | 'openfoodfacts'
  barcode?: string
  allergens?: string[]
  traces?: string[]
  /** Packungsgröße in g/ml (OFF) — Vorbelegung für die Preis-Eingabe. */
  packageSize?: number
}

/**
 * Purer Merge: OFF-Produktdaten in das (Ein-Item-)KI-Ergebnis einarbeiten.
 * Die geschätzte MENGE bleibt erhalten (die KI hat das Foto gesehen, OFF
 * nicht); Name und Nährwerte je 100 kommen exakt aus der Datenbank. Bei
 * Mehr-Item-Ergebnissen wäre die Zuordnung mehrdeutig → unverändert 'ai'.
 */
export function mergeOffIntoAnalyze(result: AiResult, off: OffProduct): EnrichedAnalyze {
  if (result.items.length !== 1) {
    return { items: result.items, notes: result.notes, questions: result.questions, source: 'ai', barcode: result.barcode }
  }
  const item = result.items[0]
  const food = off.food
  return {
    items: [
      {
        ...item,
        name: food.name || item.name,
        unit: item.unit === 'portion' ? item.unit : food.per,
        per100: {
          kcal: food.kcal,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          micros: food.micros,
        },
        // Datenbankwerte sind keine Schätzung mehr.
        confidence: 1,
      },
    ],
    notes: result.notes,
    questions: result.questions,
    source: 'openfoodfacts',
    barcode: food.barcode,
    allergens: off.allergens,
    traces: off.traces,
    packageSize: off.packageSize,
  }
}

/**
 * KI-Ergebnis per abgelesenem Barcode anreichern (best effort). Nie werfen:
 * Fehler und Nicht-Treffer fallen still auf das KI-Ergebnis zurück.
 */
export async function enrichAnalyzeWithBarcode(result: AiResult): Promise<EnrichedAnalyze> {
  const fallback: EnrichedAnalyze = {
    items: result.items,
    notes: result.notes,
    questions: result.questions,
    source: 'ai',
  }
  if (!result.barcode) return fallback
  try {
    const off = await lookupBarcode(result.barcode)
    if (!off) return fallback
    return mergeOffIntoAnalyze(result, off)
  } catch {
    return fallback
  }
}
