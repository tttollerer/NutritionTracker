import type { Goal, LogEntry } from '@/db/types'
import { BENEFIT_KEYS, LIMIT_KEYS, NUTRIENT_BY_KEY, nutrientTarget } from './nutrients'

/**
 * Deterministische Defizit-Engine (PLAN.md §9.3 / EVALUATION P0).
 * Summiert die Mikronährstoffe des Tages und stellt sie den Referenzzielen
 * gegenüber: Benefits → "noch X bis Ziel", Limits → "noch X im Budget / drüber".
 */
export interface NutrientStatus {
  key: string
  unit: string
  kind: 'benefit' | 'limit'
  consumed: number
  target: number
  remaining: number // benefit: bis Ziel; limit: bis Obergrenze (negativ = drüber)
  pct: number // 0..1+ Anteil am Ziel/Limit
}

export interface DayNutrition {
  benefits: NutrientStatus[]
  limits: NutrientStatus[]
}

export interface DeficitOpts {
  proteinTarget?: number
  sex?: 'm' | 'f'
  vegan?: boolean
  /** Überschreibt Limit-Grenzen (z. B. strengeres Zucker-Limit bei Diabetes). */
  limitOverrides?: Record<string, number>
  /** Überschreibt Benefit-Ziele (z. B. übernommenes Coach-Ballaststoff-Ziel, Vertrag v1.2). */
  benefitOverrides?: Record<string, number>
}

/**
 * Übernommene Coach-Ziele (Vertrag v1.2) in die Defizit-Anzeige einspeisen:
 * Limit-Nährstoffe (sugar/sodium/…) mit max/range-Ziel → limitOverrides,
 * Benefit-Nährstoffe (fiber/…) mit Min-Ziel → benefitOverrides. Makros (kcal,
 * protein, carbs, fat) laufen weiter über ihre eigene Zielanzeige.
 */
export function overridesFromGoals(goals: Record<string, Goal>): {
  limitOverrides: Record<string, number>
  benefitOverrides: Record<string, number>
} {
  const limitOverrides: Record<string, number> = {}
  const benefitOverrides: Record<string, number> = {}
  for (const key of LIMIT_KEYS) {
    const g = goals[key]
    if (g?.active && g.type !== 'min') {
      limitOverrides[key] = g.type === 'range' ? (g.targetMax ?? g.target) : g.target
    }
  }
  for (const key of BENEFIT_KEYS) {
    const g = goals[key]
    if (g?.active && g.type !== 'max') benefitOverrides[key] = g.target
  }
  return { limitOverrides, benefitOverrides }
}

/** Mikronährstoff-Summen eines Tages aus den Log-Einträgen. */
export function sumMicros(logs: LogEntry[], date: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of logs) {
    if (l.date !== date || l.deletedAt || !l.computed.micros) continue
    for (const [k, v] of Object.entries(l.computed.micros)) out[k] = (out[k] ?? 0) + v
  }
  return out
}

export function computeDayNutrition(logs: LogEntry[], date: string, opts: DeficitOpts = {}): DayNutrition {
  const micros = sumMicros(logs, date)
  const proteinConsumed = logs
    .filter((l) => l.date === date && !l.deletedAt)
    .reduce((a, l) => a + l.computed.protein, 0)

  const benefits: NutrientStatus[] = []

  // Protein als Benefit (Ziel aus dem Makro-Ziel).
  if (opts.proteinTarget) {
    benefits.push(status('protein', 'g', 'benefit', proteinConsumed, opts.proteinTarget))
  }

  for (const key of BENEFIT_KEYS) {
    const def = NUTRIENT_BY_KEY[key]
    const target = opts.benefitOverrides?.[key] ?? nutrientTarget(def, { sex: opts.sex, vegan: opts.vegan })
    benefits.push(status(key, def.unit, 'benefit', round2(micros[key] ?? 0), target))
  }

  const limits: NutrientStatus[] = LIMIT_KEYS.map((key) => {
    const def = NUTRIENT_BY_KEY[key]
    const cap = opts.limitOverrides?.[key] ?? def.ref
    return status(key, def.unit, 'limit', round2(micros[key] ?? 0), cap)
  })

  return { benefits, limits }
}

function status(
  key: string,
  unit: string,
  kind: 'benefit' | 'limit',
  consumed: number,
  target: number,
): NutrientStatus {
  const pct = target > 0 ? consumed / target : 0
  const remaining = kind === 'benefit' ? Math.max(0, round2(target - consumed)) : round2(target - consumed)
  return { key, unit, kind, consumed, target, remaining, pct }
}

/** Offene Benefit-Defizite, größtes relatives Defizit zuerst (für Empfehlungen). */
export function rankDeficits(day: DayNutrition): NutrientStatus[] {
  return day.benefits
    .filter((b) => b.remaining > 0 && b.pct < 1)
    .sort((a, b) => a.pct - b.pct)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
