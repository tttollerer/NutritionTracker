import type { GlucoseContext } from '@/db/types'

/**
 * Blutzucker-Bewertung (optionales Diabetes-Modul). Intern immer in mg/dl;
 * Anzeige optional in mmol/l. Schwellen sind orientierende Richtwerte —
 * KEIN Ersatz für ärztliche Beratung.
 */
export type GlucoseLevel = 'low' | 'normal' | 'elevated' | 'high'

const MGDL_PER_MMOL = 18

export function toMgdl(value: number, unit: 'mg/dl' | 'mmol/l'): number {
  return unit === 'mmol/l' ? Math.round(value * MGDL_PER_MMOL) : Math.round(value)
}

export function fromMgdl(mgdl: number, unit: 'mg/dl' | 'mmol/l'): number {
  return unit === 'mmol/l' ? Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10 : Math.round(mgdl)
}

/** Bewertet einen Messwert (mg/dl) nach Kontext. */
export function classifyGlucose(mgdl: number, context: GlucoseContext): GlucoseLevel {
  if (mgdl < 70) return 'low'
  if (context === 'after') {
    if (mgdl < 140) return 'normal'
    if (mgdl < 200) return 'elevated'
    return 'high'
  }
  // nüchtern / vor Mahlzeit / random
  if (mgdl <= 99) return 'normal'
  if (mgdl <= 125) return 'elevated'
  return 'high'
}

/** Sollte für diesen Wert eine Warnung gezeigt werden? */
export function glucoseWarning(mgdl: number, context: GlucoseContext): GlucoseLevel | null {
  const level = classifyGlucose(mgdl, context)
  return level === 'low' || level === 'high' ? level : null
}

/** Strengeres Zucker-Tageslimit (g), wenn der Zucker-Warner aktiv ist. */
export const DIABETES_SUGAR_LIMIT_G = 25
