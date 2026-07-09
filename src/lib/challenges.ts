import { db } from '@/db'
import type { Challenge, Goal, LogEntry } from '@/db/types'
import { goalMet, sumsByDate, type DaySums } from './gamification'
import { lastNDayKeys } from './insights'

/**
 * Challenge-Auswertung (Paket 10). Challenges kommen vom Coach und werden in
 * repo.applyChallengeSuggestion angelegt — historisch mit leerem `rule: {}`.
 * Pragmatische Regel deshalb:
 *  - rule mit { nutrient, type, target } (wie Goal) + Challenge-period
 *    ('day'|'week') → automatisch gegen die Tages-Summen auswertbar.
 *  - leeres/unbekanntes rule → Challenge ist "manuell": sichtbar, mit
 *    Erledigt/Abbrechen-Aktionen, aber ohne berechneten Fortschritt.
 */

/**
 * Auswertbare Nährstoffe (Vertrag v1.2 = COACH_NUTRIENTS in apiContract.ts):
 * die vier Makros direkt aus DaySums, sugar/fiber/sodium als Summen der
 * getrackten computed.micros (Schlüssel aus src/lib/nutrients.ts, werden von
 * sumsByDate mitsummiert).
 */
export const TRACKED = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'fiber', 'sodium'] as const
export type TrackedNutrient = (typeof TRACKED)[number]

/** Wochen-Challenges gelten als geschafft, wenn die Tagesregel an so vielen Tagen erfüllt ist. */
export const CHALLENGE_WEEK_DAYS_DEFAULT = 5

export interface ChallengeRule {
  nutrient: TrackedNutrient
  type: Goal['type']
  target: number
  targetMax?: number
  unit?: string
  /** Nur period 'week': geforderte Erfolgstage (Default 5). */
  days?: number
}

/** Validiert das unknown-rule-Feld; leeres Objekt / Fremdformat → null (manuelle Challenge). */
export function parseChallengeRule(rule: unknown): ChallengeRule | null {
  if (!rule || typeof rule !== 'object') return null
  const r = rule as Record<string, unknown>
  if (
    typeof r.nutrient !== 'string' ||
    !(TRACKED as readonly string[]).includes(r.nutrient) ||
    (r.type !== 'min' && r.type !== 'max' && r.type !== 'range') ||
    typeof r.target !== 'number' ||
    !(r.target > 0)
  ) {
    return null
  }
  return {
    nutrient: r.nutrient as TrackedNutrient,
    type: r.type,
    target: r.target,
    targetMax: typeof r.targetMax === 'number' ? r.targetMax : undefined,
    unit: typeof r.unit === 'string' ? r.unit : undefined,
    days: typeof r.days === 'number' && r.days >= 1 && r.days <= 7 ? Math.round(r.days) : undefined,
  }
}

function asGoal(rule: ChallengeRule): Goal {
  return {
    id: 'challenge',
    nutrient: rule.nutrient,
    type: rule.type,
    target: rule.target,
    targetMax: rule.targetMax,
    unit: rule.unit ?? '',
    active: true,
    createdBy: 'coach',
    updatedAt: 0,
  }
}

export interface ChallengeProgress {
  kind: 'day' | 'week'
  /** Tages-Challenge: heutiger Nährstoffwert. Wochen-Challenge: erfüllte Tage. */
  current: number
  /** Tages-Challenge: rule.target. Wochen-Challenge: geforderte Tage. */
  target: number
  unit?: string
  met: boolean
  /** 0..1 für die Fortschrittsanzeige. */
  pct: number
}

/**
 * Wertet eine Challenge gegen Tages-Summen aus. null = nicht automatisch
 * auswertbar (leeres rule) → UI zeigt manuelle Erledigt/Abbrechen-Aktionen.
 */
export function evaluateChallenge(
  c: Challenge,
  sums: Record<string, DaySums>,
  today: string,
): ChallengeProgress | null {
  const rule = parseChallengeRule(c.rule)
  if (!rule) return null
  const goal = asGoal(rule)

  if (c.period === 'day') {
    const value = sums[today]?.[rule.nutrient] ?? 0 // Micro-Summen sind optional (DaySums)
    return {
      kind: 'day',
      current: Math.round(value),
      target: rule.target,
      unit: rule.unit,
      met: goalMet(goal, value),
      pct: rule.target > 0 ? Math.min(1, value / rule.target) : 0,
    }
  }

  // Woche: Tagesregel über die letzten 7 Tage zählen (Tage ohne Logs = nicht erfüllt).
  const days = lastNDayKeys(today, 7)
  const hits = days.filter((d) => {
    const s = sums[d]
    return !!s && goalMet(goal, s[rule.nutrient] ?? 0)
  }).length
  const need = rule.days ?? CHALLENGE_WEEK_DAYS_DEFAULT
  return {
    kind: 'week',
    current: hits,
    target: need,
    met: hits >= need,
    pct: need > 0 ? Math.min(1, hits / need) : 0,
  }
}

export interface ChallengeView {
  challenge: Challenge
  progress: ChallengeProgress | null
}

/** Alle aktiven Challenges mit (falls möglich) berechnetem Fortschritt. */
export function evaluateActiveChallenges(
  challenges: Challenge[],
  logs: LogEntry[],
  today: string,
): ChallengeView[] {
  const active = challenges.filter((c) => c.status === 'active')
  if (active.length === 0) return []
  const sums = sumsByDate(logs)
  return active.map((c) => ({ challenge: c, progress: evaluateChallenge(c, sums, today) }))
}

// ---------------------------------------------------------------------------
// DB-Zugriff (bewusst hier statt in repo.ts — Paket 10, repo.ts parallel belegt)
// ---------------------------------------------------------------------------

/** Aktive Challenges (für Heute-Screen & Erfolge). */
export function activeChallenges(): Promise<Challenge[]> {
  return db.challenges.where('status').equals('active').toArray()
}

/** Challenge als geschafft markieren — gibt Punkte über die Gamification-Engine. */
export async function markChallengeDone(id: string): Promise<void> {
  await db.challenges.update(id, { status: 'done' as const, updatedAt: Date.now() })
}

/** Challenge abbrechen/als gescheitert markieren. */
export async function markChallengeFailed(id: string): Promise<void> {
  await db.challenges.update(id, { status: 'failed' as const, updatedAt: Date.now() })
}
