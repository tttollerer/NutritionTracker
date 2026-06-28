import type { Persona, Profile } from '@/db/types'

/**
 * Ziel-Berechnung laut PLAN.md §10: Grundumsatz (Mifflin-St-Jeor) → Tagesbedarf
 * (Aktivitätsfaktor) → Anpassung an das Ziel (ab-/zunehmen) → Makro-Verteilung
 * je nach Persona und Ernährungsform.
 */

const ACTIVITY_FACTOR: Record<Profile['activity'], number> = {
  low: 1.375,
  medium: 1.55,
  high: 1.725,
}

const GOAL_KCAL_DELTA: Record<Profile['goal'], number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
}

/** Protein in g pro kg Körpergewicht je Persona. */
const PROTEIN_PER_KG: Record<Persona, number> = {
  strength: 2.0,
  endurance: 1.4,
  weightloss: 2.0,
  weightgain: 1.8,
  general: 1.6,
}

/** Fettanteil an den Gesamtkalorien je Persona. */
const FAT_PCT: Record<Persona, number> = {
  strength: 0.25,
  endurance: 0.25,
  weightloss: 0.3,
  weightgain: 0.28,
  general: 0.3,
}

export interface MacroTargets {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

/** Grundumsatz nach Mifflin-St-Jeor. */
export function bmr(p: Pick<Profile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  return base + (p.sex === 'm' ? 5 : -161)
}

/** Tagesbedarf (kcal) inkl. Aktivität und Ziel-Anpassung. */
export function targetKcal(p: Profile): number {
  const tdee = bmr(p) * ACTIVITY_FACTOR[p.activity]
  return Math.round((tdee + GOAL_KCAL_DELTA[p.goal]) / 10) * 10
}

/** Vollständige Makro-Ziele aus dem Profil. */
export function computeTargets(p: Profile): MacroTargets {
  const kcal = targetKcal(p)
  const protein = Math.round(PROTEIN_PER_KG[p.persona] * p.weightKg)

  let fatPct = FAT_PCT[p.persona]
  let carbs: number

  if (p.dietForms.includes('keto')) {
    // Keto: Kohlenhydrate hart begrenzen, Fett füllt den Rest.
    carbs = 30
    const remaining = kcal - protein * 4 - carbs * 4
    return { kcal, protein, carbs, fat: Math.max(0, Math.round(remaining / 9)) }
  }
  if (p.dietForms.includes('lowcarb')) {
    fatPct = Math.min(fatPct + 0.1, 0.45)
  }

  const fat = Math.round((kcal * fatPct) / 9)
  const remaining = kcal - protein * 4 - fat * 9
  carbs = Math.max(0, Math.round(remaining / 4))

  return { kcal, protein, carbs, fat }
}

export const PERSONA_KEYS: Persona[] = [
  'strength',
  'endurance',
  'weightloss',
  'weightgain',
  'general',
]

export const DIET_FORMS = ['vegan', 'vegetarian', 'lowcarb', 'keto', 'highprotein', 'glutenfree']

export const COMMON_ALLERGENS = ['gluten', 'lactose', 'nuts', 'peanuts', 'soy', 'eggs', 'fish']
