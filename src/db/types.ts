/**
 * Datenmodell laut PLAN.md §5.
 * Alle IDs sind client-generierte UUIDs; `updatedAt`/`deletedAt` machen das Modell
 * für späteren Cloud-Sync (Last-Write-Wins) bereit.
 */

export type Unit = 'g' | 'ml' | 'portion'
export type Micros = Record<string, number>

export interface FoodItem {
  id: string
  name: string
  source: 'ai' | 'openfoodfacts' | 'usda' | 'manual'
  barcode?: string
  per: 'g' | 'ml'
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sugar?: number
  micros?: Micros
  allergens?: string[] // OFF-Allergen-Tags (enthält) — für Warnungen über alle Log-Pfade
  traces?: string[] // OFF-Spuren-Tags („kann Spuren enthalten")
  /**
   * Favoriten-Stern (1-Tap-Wiederholung, PLAN §7.2). Bewusst NICHT indiziert —
   * Abfragen laufen über .filter(), daher braucht das optionale Feld keine
   * neue Dexie-Schemaversion.
   */
  favorite?: boolean
  /**
   * „Mein Vorrat" (Einkauf gescannt, noch nicht gegessen). Wie `favorite`
   * bewusst NICHT indiziert — Abfragen laufen über .filter(), daher braucht
   * das optionale Feld keine neue Dexie-Schemaversion.
   */
  pantry?: boolean
  /**
   * Packungen im Vorrat. Konvention: pantry=true + pantryQty undefined == 1;
   * 0 heißt „leer" (pantry-Flag bleibt dabei erhalten → Nachkauf-Kandidat).
   * Nicht indiziert und optional — keine Dexie-Migration nötig.
   */
  pantryQty?: number
  /**
   * MHD ('YYYY-MM-DD') der aktuell offenen Packung. Nicht indiziert und
   * optional — keine Dexie-Migration nötig.
   */
  expiryDate?: string
  /**
   * Ältere Packungspreise (Preis-Verlauf, neueste zuerst, max. 20 Einträge) —
   * der aktuelle Preis bleibt in `price`. `at` = Zeitpunkt der Ablösung.
   * Nicht indiziert und optional — keine Dexie-Migration nötig.
   */
  priceHistory?: { amount: number; per: number; at: number }[]
  /**
   * Gemerkte übliche Portion. `label` ist ein optionaler Anzeige-Name der
   * Portion (z. B. „Tasse", „Riegel") → UI zeigt „1 Tasse (80 g)".
   */
  defaultPortion?: { amount: number; unit: Unit; label?: string }
  /**
   * Benannte Portionseinheiten des Produkts („Stück" = 22 g, „Dose" = 500 ml,
   * „Cup" = 90 g …); `amount` je 1 Einheit in der Basis-Einheit (per). Quelle:
   * Nutzer (Detail-Editor) oder OFF-Portions-/Packungsangabe beim Scan. Logs
   * speichern weiterhin Basis-Mengen — die Einheit ist reine Eingabe-/Anzeige-
   * Hilfe. Nicht indiziert und optional — keine Dexie-Migration nötig.
   */
  servings?: { label: string; amount: number }[]
  /**
   * Optionaler Packungspreis (Haushaltskasse): `amount` in EUR für eine
   * Packung von `per` g bzw. ml. Kosten eines Logs = verzehrte Menge / per
   * * amount. Nicht indiziert, additiv — keine Dexie-Migration nötig.
   */
  price?: { amount: number; per: number }
  /**
   * Produktfotos: IDs von Zeilen der bestehenden `photos`-Tabelle (Data-URLs).
   * Wie `favorite`/`pantry` bewusst NICHT indiziert und optional — additiv,
   * keine Dexie-Migration nötig. Reihenfolge = Anzeige-Reihenfolge.
   */
  photoIds?: string[]
  /**
   * Freitext-Beschreibung des Produkts (Lebensmittel-Detail). Wie `favorite`
   * bewusst NICHT indiziert und optional — additiv, keine Dexie-Migration nötig.
   */
  description?: string
  /**
   * Kategorie-/Frei-Tags (z. B. „Milchprodukt", „Frühstück") für Filter im
   * Einkauf/Vorrat und Chips im Detail. Nicht indiziert — Abfragen laufen über
   * .filter(), daher keine Dexie-Schemaversion nötig.
   */
  tags?: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface LogEntry {
  id: string
  foodId: string
  date: string // 'YYYY-MM-DD'
  meal: Meal
  loggedAt: number
  amount: number
  unit: Unit
  computed: { kcal: number; protein: number; carbs: number; fat: number; micros?: Micros }
  /**
   * Kosten-Snapshot in EUR (Haushaltskasse), beim Loggen aus FoodItem.price
   * berechnet. Snapshot statt Live-Berechnung: die Historie bleibt stabil,
   * auch wenn der Packungspreis später geändert wird. Optional & additiv.
   */
  cost?: number
  /**
   * Geplante, noch nicht gegessene Mahlzeit (Wochenplaner). Zählt NICHT in
   * Verzehr-Summen/Gamification — wird dort zentral wie deletedAt gefiltert.
   * confirmPlanned() entfernt das Flag beim tatsächlichen Essen. Optional &
   * additiv — keine Dexie-Migration nötig.
   */
  planned?: boolean
  /**
   * Anzeige-Snapshot, wenn in einer benannten Portionseinheit erfasst wurde
   * („2 Stück"): `amount`/`unit` halten weiterhin die Basis-Menge (z. B. 44 g),
   * gerechnet wird NUR damit. Optional & additiv — keine Dexie-Migration nötig.
   */
  serving?: { label: string; count: number }
  photoBlobId?: string
  aiRaw?: unknown
  updatedAt: number
  deletedAt?: number
}

export interface Goal {
  id: string
  nutrient: string // 'kcal' | 'protein' | 'vitaminC' | ...
  type: 'min' | 'max' | 'range'
  target: number
  targetMax?: number
  unit: string
  active: boolean
  createdBy: 'user' | 'coach'
  updatedAt: number
  deletedAt?: number
}

export type Persona = 'strength' | 'endurance' | 'weightloss' | 'weightgain' | 'general'

export interface Profile {
  id: 'me'
  sex: 'm' | 'f'
  age: number
  heightCm: number
  weightKg: number
  activity: 'low' | 'medium' | 'high'
  goal: 'lose' | 'maintain' | 'gain'
  persona: Persona
  dietForms: string[] // ['vegan','lowcarb','glutenfree']
  proteinPerKgOverride?: number // optionaler individueller Protein-Wert (g/kg) statt Persona-Default
  updatedAt: number
}

export interface Achievement {
  id: string
  key: string
  unlockedAt: number
}

export interface Challenge {
  id: string
  title: string
  rule: unknown
  period: 'day' | 'week'
  status: 'suggested' | 'active' | 'done' | 'failed'
  createdBy: 'user' | 'coach'
  updatedAt: number
}

export interface GamificationState {
  id: 'me'
  points: number
  level: number
  streaks: Record<string, number>
  freezeTokens: number
  /**
   * Lückentage ('YYYY-MM-DD'), die bereits mit einem Freeze-Token überbrückt
   * wurden. Macht den Token-Verbrauch idempotent: derselbe Lückentag kostet
   * nie zweimal. Optionales, nicht indiziertes Feld — keine Dexie-Migration nötig.
   */
  frozenDates?: string[]
  unlocked: string[]
  companion?: { type: string; stage: number; mood: 'happy' | 'ok' | 'sad' }
  updatedAt: number
}

export interface CoachMemory {
  id: 'me'
  diet?: string
  allergies: string[]
  dislikes: string[]
  likes: string[]
  tone: 'motivating' | 'casual' | 'strict'
  notes?: string
  updatedAt: number
}

export interface WaterLog {
  id: string
  date: string
  ml: number
  loggedAt: number
  updatedAt: number
  deletedAt?: number
}

/** Lokal gespeichertes Mahlzeitenfoto (verkleinertes JPEG als Data-URL). */
export interface Photo {
  id: string
  dataUrl: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/** App-Einstellungen / optionale Gesundheits-Module (wie Allergien: nicht für jeden). */
export interface Settings {
  id: 'app'
  bloodSugar: boolean // Blutzucker-Tracking (Diabetes)
  sugarWarner: boolean // strengeres Zucker-Limit
  glucoseUnit: 'mg/dl' | 'mmol/l'
  labValues?: boolean // opt-in: Laborwerte (Ferritin, Vitamin D, B12, HbA1c, Blutfette)
  vitals?: boolean // opt-in: Vitalwerte (Blutdruck, Ruhepuls)
  photoConsent?: boolean // einmalige Einwilligung: Fotos an KI-Dienst senden
  weeklyBudget?: number // Lebensmittel-Budget in EUR pro Woche (Haushaltskasse), optional
  updatedAt: number
}

/**
 * Eintrag der Einkaufsliste (eigene Tabelle, Dexie v6). `source` hält fest,
 * wie der Eintrag entstand: 'auto' (Vorrat fast leer), 'manual' (Nutzer),
 * 'plan' (fehlende Zutat aus dem Wochenplan). `foodId` verknüpft optional mit
 * dem Katalog — Abhaken legt die Packung dann in den Vorrat.
 */
export interface ShoppingItem {
  id: string
  name: string
  foodId?: string
  qty?: number
  note?: string
  source: 'auto' | 'manual' | 'plan'
  checked: boolean
  updatedAt: number
  deletedAt?: number
}

/** Zutat eines Rezepts; `amount` gilt für das GANZE Rezept (alle Portionen). */
export interface RecipeIngredient {
  foodId: string
  amount: number
  unit: Unit
}

/** Eigenes Rezept (eigene Tabelle, Dexie v6). Loggen skaliert die Zutaten. */
export interface Recipe {
  id: string
  name: string
  portions: number
  ingredients: RecipeIngredient[]
  description?: string
  updatedAt: number
  deletedAt?: number
}

/**
 * Verlaufswert (Körper/Labor/Vitalwerte/Insulin). Generisch gehalten, damit neue
 * Messgrößen ohne Schema-Umbau ergänzbar sind. `type` referenziert MetricDef.key.
 */
export interface Measurement {
  id: string
  type: string
  value: number
  unit: string
  date: string // 'YYYY-MM-DD'
  note?: string
  loggedAt: number
  updatedAt: number
  deletedAt?: number
}

export type GlucoseContext = 'fasting' | 'before' | 'after' | 'random'

/** Manuell eingetragener Blutzucker-Messwert. */
export interface GlucoseReading {
  id: string
  date: string // 'YYYY-MM-DD'
  mgdl: number // intern immer in mg/dl gespeichert
  context: GlucoseContext
  note?: string
  loggedAt: number
  updatedAt: number
  deletedAt?: number
}
