import type { Meal } from '@/db/types'

/** Sinnvolle Mahlzeit-Voreinstellung nach Tageszeit. */
export function defaultMeal(d = new Date()): Meal {
  const h = d.getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']
