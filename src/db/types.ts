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
  defaultPortion?: { amount: number; unit: Unit }
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
  updatedAt: number
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
