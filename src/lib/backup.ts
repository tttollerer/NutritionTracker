import { db } from '@/db'

/** Alle Tabellen als JSON exportieren (Backup, PLAN.md §A3). */
export async function exportBackup(): Promise<Blob> {
  const data = {
    version: 1,
    exportedAt: Date.now(),
    foods: await db.foods.toArray(),
    logs: await db.logs.toArray(),
    goals: await db.goals.toArray(),
    profile: await db.profile.toArray(),
    achievements: await db.achievements.toArray(),
    challenges: await db.challenges.toArray(),
    gamification: await db.gamification.toArray(),
    coachMemory: await db.coachMemory.toArray(),
    water: await db.water.toArray(),
    photos: await db.photos.toArray(),
    settings: await db.settings.toArray(),
    glucose: await db.glucose.toArray(),
    measurements: await db.measurements.toArray(),
  }
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
}

/** Backup einspielen (überschreibt vorhandene Daten). */
export async function importBackup(json: string): Promise<void> {
  const data = JSON.parse(json)
  await db.transaction(
    'rw',
    [db.foods, db.logs, db.goals, db.profile, db.achievements, db.challenges, db.gamification, db.coachMemory, db.water, db.photos, db.settings, db.glucose, db.measurements],
    async () => {
      await Promise.all([
        db.foods.clear(),
        db.logs.clear(),
        db.goals.clear(),
        db.profile.clear(),
        db.achievements.clear(),
        db.challenges.clear(),
        db.gamification.clear(),
        db.coachMemory.clear(),
        db.water.clear(),
        db.photos.clear(),
        db.settings.clear(),
        db.glucose.clear(),
        db.measurements.clear(),
      ])
      if (data.foods) await db.foods.bulkPut(data.foods)
      if (data.logs) await db.logs.bulkPut(data.logs)
      if (data.goals) await db.goals.bulkPut(data.goals)
      if (data.profile) await db.profile.bulkPut(data.profile)
      if (data.achievements) await db.achievements.bulkPut(data.achievements)
      if (data.challenges) await db.challenges.bulkPut(data.challenges)
      if (data.gamification) await db.gamification.bulkPut(data.gamification)
      if (data.coachMemory) await db.coachMemory.bulkPut(data.coachMemory)
      if (data.water) await db.water.bulkPut(data.water)
      if (data.photos) await db.photos.bulkPut(data.photos)
      if (data.settings) await db.settings.bulkPut(data.settings)
      if (data.glucose) await db.glucose.bulkPut(data.glucose)
      if (data.measurements) await db.measurements.bulkPut(data.measurements)
    },
  )
}

export function downloadBackup(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nutritiontracker-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
