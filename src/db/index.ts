import Dexie, { type Table } from 'dexie'
import type {
  Achievement,
  Challenge,
  CoachMemory,
  FoodItem,
  GamificationState,
  GlucoseReading,
  Goal,
  LogEntry,
  Measurement,
  Photo,
  Profile,
  Settings,
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
  settings!: Table<Settings, string>
  glucose!: Table<GlucoseReading, string>
  measurements!: Table<Measurement, string>

  constructor(name = 'nutritiontracker') {
    super(name)
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
    // v3: optionale Gesundheits-Module (Einstellungen + Blutzucker).
    this.version(3).stores({
      settings: 'id, updatedAt',
      glucose: 'id, date, loggedAt, deletedAt',
    })
    // v4: Verlaufswerte (Körper/Labor/Vitalwerte/Insulin).
    this.version(4).stores({
      measurements: 'id, type, date, loggedAt, deletedAt, [type+date]',
    })
    // v5: Sync-Bereitschaft für Wasser & Fotos — updatedAt (und deletedAt als
    // Tombstone-Feld) nachrüsten. Bestandsdaten bekommen updatedAt = Migrationszeitpunkt.
    // Die Migration ist idempotent: bereits gesetzte Werte bleiben unangetastet.
    this.version(5)
      .stores({
        water: 'id, date, loggedAt, updatedAt, deletedAt',
        photos: 'id, createdAt, updatedAt, deletedAt',
      })
      .upgrade(async (tx) => {
        const t = Date.now()
        await tx
          .table('water')
          .toCollection()
          .modify((w: { updatedAt?: number }) => {
            if (w.updatedAt == null) w.updatedAt = t
          })
        await tx
          .table('photos')
          .toCollection()
          .modify((p: { updatedAt?: number }) => {
            if (p.updatedAt == null) p.updatedAt = t
          })
      })
  }
}

export const db = new NutritionDB()
