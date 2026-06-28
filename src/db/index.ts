import Dexie, { type Table } from 'dexie'
import type {
  Achievement,
  Challenge,
  CoachMemory,
  FoodItem,
  GamificationState,
  Goal,
  LogEntry,
  Photo,
  Profile,
  WaterLog,
} from './types'

/**
 * Versioniertes Dexie-Schema (IndexedDB). Indizes nur auf Feldern, nach denen
 * wir wirklich abfragen. Schema-Migrationen werden über aufsteigende version()
 * gepflegt — von Anfang an mitgeplant.
 */
export class NutritionDB extends Dexie {
  foods!: Table<FoodItem, string>
  logs!: Table<LogEntry, string>
  goals!: Table<Goal, string>
  profile!: Table<Profile, string>
  achievements!: Table<Achievement, string>
  challenges!: Table<Challenge, string>
  gamification!: Table<GamificationState, string>
  coachMemory!: Table<CoachMemory, string>
  water!: Table<WaterLog, string>
  photos!: Table<Photo, string>

  constructor() {
    super('nutritiontracker')
    this.version(1).stores({
      foods: 'id, name, barcode, updatedAt, deletedAt',
      logs: 'id, foodId, date, meal, updatedAt, deletedAt, [date+meal]',
      goals: 'id, nutrient, active, updatedAt, deletedAt',
      profile: 'id, updatedAt',
      achievements: 'id, key, unlockedAt',
      challenges: 'id, status, period, updatedAt',
      gamification: 'id, updatedAt',
      coachMemory: 'id, updatedAt',
      water: 'id, date, loggedAt',
    })
    // v2: Mahlzeitenfotos (lokal).
    this.version(2).stores({
      photos: 'id, createdAt',
    })
  }
}

export const db = new NutritionDB()
