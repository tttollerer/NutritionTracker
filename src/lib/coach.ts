import { z } from 'zod'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import { sumsByDate } from './gamification'
import { todayKey } from './utils'

/** Coach-Antwort-Schema (deckungsgleich mit der Netlify-Function). */
export const CoachSuggestions = z.object({
  goals: z
    .array(
      z.object({
        nutrient: z.string(),
        type: z.enum(['min', 'max', 'range']),
        target: z.number(),
        targetMax: z.number().optional(),
        unit: z.string(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  challenges: z.array(z.object({ title: z.string(), period: z.enum(['day', 'week']) })).optional(),
  logs: z
    .array(
      z.object({
        name: z.string(),
        amount: z.number(),
        unit: z.enum(['g', 'ml', 'portion']),
        per100: z.object({ kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number() }),
      }),
    )
    .optional(),
})
export const CoachResult = z.object({ reply: z.string(), suggestions: CoachSuggestions.optional() })

export type CoachResult = z.infer<typeof CoachResult>
export type CoachSuggestions = z.infer<typeof CoachSuggestions>
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: CoachSuggestions
}

const ENDPOINT = import.meta.env.VITE_COACH_URL ?? '/api/coach'

/** Aggregierte, datensparsame Zusammenfassung als Coach-Kontext (keine Fotos/Rohdaten). */
export async function buildCoachContext() {
  const today = todayKey()
  const [profile, goalsMap, logs] = await Promise.all([
    db.profile.get('me'),
    getActiveGoalsMap(),
    db.logs.filter((l) => !l.deletedAt).toArray(),
  ])

  const byDate = sumsByDate(logs)
  const todaySums = byDate[today] ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }

  // Wochenmittel der letzten 7 Tage mit Einträgen.
  const last7 = Object.entries(byDate)
    .filter(([d]) => d <= today)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 7)
    .map(([, s]) => s)
  const weekAvg = last7.length
    ? {
        kcal: Math.round(last7.reduce((a, s) => a + s.kcal, 0) / last7.length),
        protein: Math.round(last7.reduce((a, s) => a + s.protein, 0) / last7.length),
        carbs: Math.round(last7.reduce((a, s) => a + s.carbs, 0) / last7.length),
        fat: Math.round(last7.reduce((a, s) => a + s.fat, 0) / last7.length),
      }
    : null

  const goals = Object.fromEntries(
    Object.values(goalsMap).map((g) => [g.nutrient, { type: g.type, target: g.target, targetMax: g.targetMax, unit: g.unit }]),
  )

  return {
    profile: profile
      ? { persona: profile.persona, dietForms: profile.dietForms, goal: profile.goal, weightKg: profile.weightKg }
      : null,
    goals,
    today: todaySums,
    weekAvg,
  }
}

export async function getMemory() {
  return db.coachMemory.get('me')
}

/** Coach aufrufen: Verlauf + aktueller Kontext + Gedächtnis. */
export async function sendCoach(messages: ChatMessage[]): Promise<CoachResult> {
  const [context, memory] = await Promise.all([buildCoachContext(), getMemory()])
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      context,
      memory: memory ? { diet: memory.diet, allergies: memory.allergies, likes: memory.likes, dislikes: memory.dislikes, tone: memory.tone } : null,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? `Coach-Anfrage fehlgeschlagen (${res.status})`)
  return CoachResult.parse(data)
}
