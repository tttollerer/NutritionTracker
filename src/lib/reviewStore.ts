import type { AiItem, AnalyzeMode } from './ai'
import type { Meal, Unit } from '@/db/types'

/**
 * Zwischenspeicher für den Prüf-Screen. In sessionStorage, damit das Ergebnis
 * einen Reload übersteht und nicht im Router-State verloren geht.
 */
export interface ReviewPayload {
  items: AiItem[]
  meal: Meal
  source: 'ai' | 'openfoodfacts'
  barcode?: string
  photo?: string // verkleinertes Foto (Data-URL), optional
  allergens?: string[] // OFF-Allergen-Tags (bei Barcode-Produkten)
  traces?: string[] // OFF-Spuren-Tags („kann Spuren enthalten")
  notes?: string // freie Hinweise der KI zum Ergebnis (AnalyzeResult.notes)
  // --- KI-Verfeinerungsschleife (Paket B) ---
  /** Analyse-Modus des Ursprungs-Requests — für „Neu schätzen" im Review. */
  mode?: AnalyzeMode
  /** Bisheriger Hint an die KI; wird beim Verfeinern mit der Zusatzinfo kombiniert. */
  hint?: string
  /** Analysiertes Bild (bereits verkleinert, ~1024 px q0.7) für die Neu-Schätzung. */
  imageBase64?: string
  /** Kurze Rückfragen der KI (AnalyzeResult.questions) — als Chips antippbar. */
  questions?: string[]
}

const KEY = 'nt-review'

/**
 * Payload speichern — quota-tolerant (Muster chatStore.saveChat): schlägt das
 * Schreiben fehl (sessionStorage voll, Bild-Daten), wird zuerst `imageBase64`
 * (nur für die Verfeinerung nötig — der Refine-Abschnitt blendet sich dann
 * einfach aus), notfalls auch `photo` verworfen. Items/Meta gehen nie verloren.
 */
export function setReview(payload: ReviewPayload) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    try {
      const { imageBase64, ...withoutRefineImage } = payload
      void imageBase64
      sessionStorage.setItem(KEY, JSON.stringify(withoutRefineImage))
    } catch {
      try {
        const { imageBase64, photo, ...bare } = payload
        void imageBase64
        void photo
        sessionStorage.setItem(KEY, JSON.stringify(bare))
      } catch {
        // Selbst der Rest passt nicht — flüchtiger Arbeitszustand, kein Crash.
      }
    }
  }
}

export function getReview(): ReviewPayload | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReviewPayload
  } catch {
    return null
  }
}

export function clearReview() {
  sessionStorage.removeItem(KEY)
}

// ---------------------------------------------------------------------------
// Mengen-Presets für den Prüf-Screen (hier statt in Review.tsx, damit die
// Logik ohne React-Baum testbar ist).
// ---------------------------------------------------------------------------

/**
 * Fix für die Portion-Fehlbuchung (Usability-Audit, Paket 9):
 * Liefert die KI unit='portion', sind die Presets PORTIONS-Zähler (¼–2),
 * keine Gramm-Werte — sonst loggt der Preset „100" 100 Portionen à 100 g
 * (= 10.000 g). Gewählt wurde Variante (b) „Portion als sichtbare dritte
 * Einheit" statt Gramm-Normalisierung, weil der API-Vertrag (AnalyzeItemSchema)
 * KEINE Grammschätzung pro Portion mitliefert — eine Normalisierung müsste
 * einen Gramm-Wert erfinden. 'portion' ist zudem bereits eine vollwertige Unit
 * im Datenmodell; computeLogValues löst sie über defaultPortion (Fallback 100 g)
 * korrekt auf.
 */
export const MASS_PRESETS = [50, 100, 150, 200] as const
export const PORTION_PRESETS = [0.25, 0.5, 1, 1.5, 2] as const

export function presetsFor(unit: Unit): readonly number[] {
  return unit === 'portion' ? PORTION_PRESETS : MASS_PRESETS
}

/** Anzeige-Label eines Presets (¼/½ statt 0.25/0.5, deutsches Komma). */
export function presetLabel(value: number): string {
  if (value === 0.25) return '¼'
  if (value === 0.5) return '½'
  return String(value).replace('.', ',')
}

/**
 * Menge beim Einheitenwechsel plausibel halten: Ein Gramm-Wert (z. B. 150)
 * ist als Portionszahl absurd — und umgekehrt. Heuristik: > 10 kann keine
 * Portionszahl sein, ≤ 10 keine sinnvolle Gramm-/ml-Menge aus dem Prüf-Screen.
 */
export function amountForUnitSwitch(amount: number, to: Unit): number {
  if (to === 'portion') return amount > 10 ? 1 : amount
  return amount <= 10 ? 100 : amount
}
