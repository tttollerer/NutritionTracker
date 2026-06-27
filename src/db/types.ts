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
}
