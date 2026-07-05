import { v4 as uuid } from 'uuid'
import { db } from './index'
import type { FoodItem, GlucoseContext, GlucoseReading, Goal, LogEntry, Meal, Measurement, Profile, Settings, Unit } from './types'
import { computeTargets, kcalFloor } from '@/lib/nutrition'
import { todayKey } from '@/lib/utils'

const now = () => Date.now()

/** Profil aus dem Onboarding speichern und daraus die Ziele ableiten. */
export async function saveOnboarding(profile: Omit<Profile, 'id' | 'updatedAt'>, allergies: string[]) {
  const fullProfile: Profile = { ...profile, id: 'me', updatedAt: now() }
  const goals = baseGoals(fullProfile)

  await db.transaction('rw', db.profile, db.goals, db.coachMemory, db.gamification, async () => {
    await db.profile.put(fullProfile)
    await db.goals.bulkPut(goals)
    await db.coachMemory.put({
      id: 'me',
      allergies,
      dislikes: [],
      likes: [],
      tone: 'motivating',
      updatedAt: now(),
    })
    const existing = await db.gamification.get('me')
    if (!existing) {
      await db.gamification.put({
        id: 'me',
        points: 0,
        level: 1,
        streaks: {},
        freezeTokens: 1,
        unlocked: [],
        updatedAt: now(),
      })
    }
  })

  return { profile: fullProfile, targets: computeTargets(fullProfile) }
}

/** Profil bearbeiten und die Basis-Ziele neu berechnen (ohne Logs/Verlauf zu verlieren). */
export async function updateProfile(patch: Partial<Omit<Profile, 'id'>>) {
  const current = await db.profile.get('me')
  if (!current) return
  const updated: Profile = { ...current, ...patch, id: 'me', updatedAt: now() }
  const goals = baseGoals(updated)
  await db.transaction('rw', db.profile, db.goals, async () => {
    await db.profile.put(updated)
    // Nur die vom System gesetzten Basis-Ziele neu berechnen; Coach-/Nutzer-Ziele bleiben.
    await db.goals.bulkPut(goals)
  })
  // Gewichtsänderung als Messpunkt festhalten, damit der Verlauf konsistent bleibt.
  if (patch.weightKg != null && patch.weightKg !== current.weightKg) {
    await addMeasurement('weight', patch.weightKg, 'kg')
  }
  return { profile: updated, targets: computeTargets(updated) }
}

/** Die vier vom System abgeleiteten Basis-Ziele (deterministische IDs). */
function baseGoals(p: Profile): Goal[] {
  const t = computeTargets(p)
  return [
    mkGoal('kcal', p.goal === 'lose' ? 'max' : p.goal === 'gain' ? 'min' : 'range', t.kcal, 'kcal'),
    mkGoal('protein', 'min', t.protein, 'g'),
    mkGoal('carbs', 'range', t.carbs, 'g'),
    mkGoal('fat', 'range', t.fat, 'g'),
  ]
}

function mkGoal(nutrient: string, type: Goal['type'], target: number, unit: string): Goal {
  return {
    // Deterministische ID pro Nährstoff → Neuberechnung überschreibt,
    // statt doppelte aktive Ziele anzulegen.
    id: `base-${nutrient}`,
    nutrient,
    type,
    target,
    unit,
    active: true,
    createdBy: 'user',
    updatedAt: now(),
  }
}

export async function getProfile() {
  return db.profile.get('me')
}

/** Aktive Ziele als nutrient→Goal Map. */
export async function getActiveGoalsMap() {
  const goals = await db.goals.filter((g) => g.active && !g.deletedAt).toArray()
  return Object.fromEntries(goals.map((g) => [g.nutrient, g]))
}

export interface NewFoodInput {
  name: string
  per: 'g' | 'ml'
  kcal: number
  protein: number
  carbs: number
  fat: number
  micros?: Record<string, number>
  allergens?: string[]
  traces?: string[]
  source?: FoodItem['source']
  barcode?: string
}

/**
 * Lebensmittel im Katalog anlegen — mit Dedupe: existiert bereits ein Eintrag mit
 * gleichem Barcode (oder ersatzweise gleichem Namen), wird dieser aktualisiert
 * (Upsert) statt ein Duplikat zu erzeugen. defaultPortion des Treffers bleibt erhalten.
 */
export async function createFood(input: NewFoodInput): Promise<FoodItem> {
  const name = input.name.trim()
  const values = {
    per: input.per,
    kcal: input.kcal,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    micros: input.micros && Object.keys(input.micros).length ? input.micros : undefined,
    allergens: input.allergens?.length ? input.allergens : undefined,
    traces: input.traces?.length ? input.traces : undefined,
  }

  let existing: FoodItem | undefined
  if (input.barcode) {
    existing = await db.foods.where('barcode').equals(input.barcode).filter((f) => !f.deletedAt).first()
  }
  if (!existing) {
    const lower = name.toLowerCase()
    existing = await db.foods.filter((f) => !f.deletedAt && f.name.toLowerCase() === lower).first()
  }

  if (existing) {
    const updated: FoodItem = {
      ...existing,
      ...values,
      name,
      barcode: input.barcode ?? existing.barcode,
      source: input.source ?? existing.source,
      updatedAt: now(),
    }
    await db.foods.put(updated)
    return updated
  }

  const food: FoodItem = {
    id: uuid(),
    name,
    source: input.source ?? 'manual',
    barcode: input.barcode,
    ...values,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.foods.put(food)
  return food
}

/** Hinterlegte Allergene des Nutzers (für Warnungen beim Erfassen). */
export async function getAllergies(): Promise<string[]> {
  const mem = await db.coachMemory.get('me')
  return mem?.allergies ?? []
}

// ---- Einstellungen / optionale Gesundheits-Module ----

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  bloodSugar: false,
  sugarWarner: false,
  glucoseUnit: 'mg/dl',
  photoConsent: false,
  updatedAt: 0,
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>) {
  const cur = await getSettings()
  await db.settings.put({ ...cur, ...patch, id: 'app', updatedAt: now() })
}

// ---- Blutzucker (Diabetes-Modul) ----

export async function addGlucose(mgdl: number, context: GlucoseContext, note?: string, date = todayKey()) {
  const reading: GlucoseReading = {
    id: uuid(),
    date,
    mgdl: Math.round(mgdl),
    context,
    note,
    loggedAt: now(),
    updatedAt: now(),
  }
  await db.glucose.put(reading)
}

export async function deleteGlucose(id: string) {
  await db.glucose.update(id, { deletedAt: now(), updatedAt: now() })
}

// ---- Verlaufswerte (Körper/Labor/Vitalwerte/Insulin) ----

export async function addMeasurement(type: string, value: number, unit: string, date = todayKey(), note?: string) {
  const m: Measurement = {
    id: uuid(),
    type,
    value,
    unit,
    date,
    note,
    loggedAt: now(),
    updatedAt: now(),
  }
  await db.measurements.put(m)
}

export async function deleteMeasurement(id: string) {
  await db.measurements.update(id, { deletedAt: now(), updatedAt: now() })
}

/** Alle (nicht gelöschten) Messwerte eines Typs, aufsteigend nach Datum. */
export async function measurementsByType(type: string): Promise<Measurement[]> {
  const all = await db.measurements.where('type').equals(type).filter((m) => !m.deletedAt).toArray()
  return all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.loggedAt - b.loggedAt))
}

/** Letztes Erfassungsdatum je Typ (für die Fälligkeits-Engine). */
export async function lastMeasurementDates(): Promise<Record<string, string>> {
  const all = await db.measurements.filter((m) => !m.deletedAt).toArray()
  const out: Record<string, string> = {}
  for (const m of all) {
    if (!out[m.type] || m.date > out[m.type]) out[m.type] = m.date
  }
  return out
}

/** Vom Coach vorgeschlagenes Ziel übernehmen (ersetzt ein vorhandenes pro Nährstoff). */
export async function applyGoalSuggestion(s: {
  nutrient: string
  type: Goal['type']
  target: number
  targetMax?: number
  unit: string
}) {
  // Sicherheit: ein vom Coach vorgeschlagenes kcal-Ziel darf nie unter den
  // physiologischen Floor fallen (Schutz vor gefährlich niedrigen Zielen).
  if (s.nutrient === 'kcal') {
    const profile = await db.profile.get('me')
    if (profile) {
      const floor = kcalFloor(profile)
      if (s.target < floor) s = { ...s, target: floor }
      if (s.targetMax != null && s.targetMax < floor) s = { ...s, targetMax: floor }
    }
  }
  const existing = await db.goals.filter((g) => g.nutrient === s.nutrient && !g.deletedAt).first()
  if (existing) {
    await db.goals.update(existing.id, { ...s, active: true, createdBy: 'coach', updatedAt: now() })
  } else {
    await db.goals.put({ id: uuid(), ...s, active: true, createdBy: 'coach', updatedAt: now() })
  }
}

/** Vom Coach vorgeschlagene Challenge als aktiv anlegen. */
export async function applyChallengeSuggestion(s: { title: string; period: 'day' | 'week' }) {
  await db.challenges.put({
    id: uuid(),
    title: s.title,
    rule: {},
    period: s.period,
    status: 'active',
    createdBy: 'coach',
    updatedAt: now(),
  })
}

/** Ein Lebensmittel aus dem kuratierten Katalog mit üblicher Portion loggen. */
export async function quickLogCatalog(
  c: {
    name: string
    per: 'g' | 'ml'
    kcal: number
    protein: number
    carbs: number
    fat: number
    micros: Record<string, number>
    serving: number
  },
  meal: Meal,
  date = todayKey(),
) {
  const food = await createFood({
    name: c.name,
    per: c.per,
    kcal: c.kcal,
    protein: c.protein,
    carbs: c.carbs,
    fat: c.fat,
    micros: c.micros,
  })
  return logFood({ food, date, meal, amount: c.serving, unit: c.per })
}

/** Verkleinertes Foto lokal speichern, gibt die Foto-ID zurück. */
export async function savePhoto(dataUrl: string): Promise<string> {
  const id = uuid()
  await db.photos.put({ id, dataUrl, createdAt: now(), updatedAt: now() })
  return id
}

/** Eine Portion eines Lebensmittels für einen Tag/Mahlzeit loggen. */
export async function logFood(args: {
  food: FoodItem
  date: string
  meal: Meal
  amount: number
  unit: Unit
  photoBlobId?: string
}): Promise<LogEntry> {
  const { food, date, meal, amount, unit, photoBlobId } = args
  // Referenzwerte gelten je 100 g/ml; 'portion' nutzt defaultPortion oder 100er-Basis.
  const grams = unit === 'portion' ? (food.defaultPortion?.amount ?? 100) * amount : amount
  const factor = grams / 100

  const entry: LogEntry = {
    id: uuid(),
    foodId: food.id,
    date,
    meal,
    loggedAt: now(),
    amount,
    unit,
    computed: {
      kcal: Math.round(food.kcal * factor),
      protein: round1(food.protein * factor),
      carbs: round1(food.carbs * factor),
      fat: round1(food.fat * factor),
      micros: scaleMicros(food.micros, factor),
    },
    photoBlobId,
    updatedAt: now(),
  }
  await db.logs.put(entry)
  // Übliche Portion nur für konkrete Mengen (g/ml) merken — eine 'portion'-Menge
  // würde sonst beim nächsten Loggen erneut mit der Portionsgröße multipliziert.
  if (unit !== 'portion') {
    await db.foods.update(food.id, { defaultPortion: { amount, unit }, updatedAt: now() })
  }
  return entry
}

/** Soft-Delete eines Log-Eintrags (sync-freundlich). */
export async function deleteLog(id: string) {
  await db.logs.update(id, { deletedAt: now(), updatedAt: now() })
}

/** Zuletzt benutzte Lebensmittel (für Schnell-Wiederholung). */
export async function recentFoods(limit = 8): Promise<FoodItem[]> {
  const foods = await db.foods.filter((f) => !f.deletedAt).toArray()
  return foods.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

/** Mikronährstoffe (je 100 g) auf die gegessene Menge skalieren. */
function scaleMicros(
  micros: Record<string, number> | undefined,
  factor: number,
): Record<string, number> | undefined {
  if (!micros) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(micros)) out[k] = Math.round(v * factor * 100) / 100
  return out
}

// ---- Wasser-Tracking (PLAN.md §9 Komfort) ----

/** Empfohlene Tagesmenge Wasser (ml): ~35 ml/kg, sonst 2000 ml. */
export function waterGoalMl(weightKg?: number): number {
  return weightKg ? Math.round((weightKg * 35) / 50) * 50 : 2000
}

export async function addWater(ml: number, date = todayKey()) {
  await db.water.put({ id: uuid(), date, ml, loggedAt: now(), updatedAt: now() })
}

/**
 * Letzten Wasser-Eintrag des Tages zurücknehmen (Undo).
 * Bewusst harter Delete: Das Undo entfernt einen soeben lokal angelegten Eintrag,
 * und die Wasser-Anzeige summiert ohne deletedAt-Filter. Beim Cloud-Sync (Phase 5)
 * auf Soft-Delete (deletedAt-Tombstone, Feld existiert seit Schema v5) umstellen.
 */
export async function undoLastWater(date = todayKey()) {
  const entries = await db.water.where('date').equals(date).filter((w) => !w.deletedAt).toArray()
  const last = entries.sort((a, b) => b.loggedAt - a.loggedAt)[0]
  if (last) await db.water.delete(last.id)
}

/** ALLE Stores leeren (kompletter Reset, z. B. „Onboarding erneut"). */
export async function resetAllData() {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
}
