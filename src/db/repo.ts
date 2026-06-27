import { v4 as uuid } from 'uuid'
import { db } from './index'
import type { FoodItem, Goal, LogEntry, Meal, Profile, Unit } from './types'
import { computeTargets } from '@/lib/nutrition'

const now = () => Date.now()

/** Profil aus dem Onboarding speichern und daraus die Ziele ableiten. */
export async function saveOnboarding(profile: Omit<Profile, 'id' | 'updatedAt'>, allergies: string[]) {
  const fullProfile: Profile = { ...profile, id: 'me', updatedAt: now() }
  const t = computeTargets(fullProfile)

  const goals: Goal[] = [
    mkGoal('kcal', profile.goal === 'lose' ? 'max' : profile.goal === 'gain' ? 'min' : 'range', t.kcal, 'kcal'),
    mkGoal('protein', 'min', t.protein, 'g'),
    mkGoal('carbs', 'range', t.carbs, 'g'),
    mkGoal('fat', 'range', t.fat, 'g'),
  ]
  if (profile.goal !== 'maintain') {
    // Für ab-/zunehmen einen Korridor um die kcal als Range ergänzen.
    goals[0].targetMax = profile.goal === 'lose' ? t.kcal : Math.round(t.kcal * 1.1)
  }

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

  return { profile: fullProfile, targets: t }
}

function mkGoal(nutrient: string, type: Goal['type'], target: number, unit: string): Goal {
  return {
    id: uuid(),
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
  source?: FoodItem['source']
  barcode?: string
}

/** Neues Lebensmittel im Katalog anlegen. */
export async function createFood(input: NewFoodInput): Promise<FoodItem> {
  const food: FoodItem = {
    id: uuid(),
    name: input.name.trim(),
    source: input.source ?? 'manual',
    barcode: input.barcode,
    per: input.per,
    kcal: input.kcal,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
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

/** Eine Portion eines Lebensmittels für einen Tag/Mahlzeit loggen. */
export async function logFood(args: {
  food: FoodItem
  date: string
  meal: Meal
  amount: number
  unit: Unit
}): Promise<LogEntry> {
  const { food, date, meal, amount, unit } = args
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
    },
    updatedAt: now(),
  }
  await db.logs.put(entry)
  // übliche Portion merken (Lernschleife, PLAN.md §6)
  await db.foods.update(food.id, { defaultPortion: { amount, unit }, updatedAt: now() })
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
