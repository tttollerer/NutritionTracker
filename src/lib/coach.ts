import { z } from 'zod'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import { sumsByDate } from './gamification'
import { computeDayNutrition, rankDeficits } from './deficit'
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
  const [profile, goalsMap, logs, settings] = await Promise.all([
    db.profile.get('me'),
    getActiveGoalsMap(),
    db.logs.filter((l) => !l.deletedAt).toArray(),
    db.settings.get('app'),
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

  // Heutige Nährstoff-Defizite (inkl. Mikros) + überschrittene Limits/Laster.
  const vegan = profile?.dietForms.includes('vegan')
  const day = computeDayNutrition(logs, today, {
    proteinTarget: goalsMap.protein?.target,
    sex: profile?.sex,
    vegan,
  })
  const deficits = rankDeficits(day)
    .slice(0, 6)
    .map((d) => ({ nutrient: d.key, remaining: d.remaining, unit: d.unit }))
  const limitsOver = day.limits
    .filter((l) => l.remaining < 0)
    .map((l) => ({ nutrient: l.key, over: Math.round(-l.remaining * 10) / 10, unit: l.unit }))

  // Blutzucker nur, wenn das Modul aktiv ist (Datensparsamkeit).
  let glucose: { lastMgdl: number; context: string } | null = null
  if (settings?.bloodSugar) {
    const readings = await db.glucose.where('date').equals(today).filter((g) => !g.deletedAt).toArray()
    const last = readings.sort((a, b) => b.loggedAt - a.loggedAt)[0]
    if (last) glucose = { lastMgdl: last.mgdl, context: last.context }
  }

  return {
    profile: profile
      ? { persona: profile.persona, dietForms: profile.dietForms, goal: profile.goal, weightKg: profile.weightKg }
      : null,
    goals,
    today: todaySums,
    weekAvg,
    deficits, // "noch X bis Ziel" je Nährstoff
    limitsOver, // überschrittene Limits (Zucker/Salz/Koffein/Alkohol)
    glucose,
  }
}

export async function getMemory() {
  return db.coachMemory.get('me')
}

/** Trenner zwischen Antworttext und Vorschlags-JSON (gestreamt). */
export const COACH_SENTINEL = '###SUGGESTIONS###'

function parseSuggestions(jsonish: string): CoachSuggestions | undefined {
  const cleaned = jsonish.trim().replace(/^```json\s*/i, '').replace(/```$/, '')
  try {
    return CoachSuggestions.parse(JSON.parse(cleaned))
  } catch {
    return undefined
  }
}

/**
 * Coach aufrufen mit Token-Streaming. `onReply` erhält den bisher empfangenen
 * Antworttext (vor dem Vorschlags-Trenner) — für Live-Anzeige + satzweise
 * Sprachausgabe. Liefert am Ende den vollständigen `CoachResult`.
 */
export async function sendCoachStream(
  messages: ChatMessage[],
  onReply: (replySoFar: string) => void,
): Promise<CoachResult> {
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

  if (!res.ok || !res.body) {
    let msg = `Coach-Anfrage fehlgeschlagen (${res.status})`
    try {
      msg = (await res.json())?.error ?? msg
    } catch {
      /* kein JSON */
    }
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    full += decoder.decode(value, { stream: true })
    const idx = full.indexOf(COACH_SENTINEL)
    onReply((idx >= 0 ? full.slice(0, idx) : full).trimStart())
  }

  const idx = full.indexOf(COACH_SENTINEL)
  const reply = (idx >= 0 ? full.slice(0, idx) : full).trim()
  const suggestions = idx >= 0 ? parseSuggestions(full.slice(idx + COACH_SENTINEL.length)) : undefined
  return { reply, suggestions }
}
