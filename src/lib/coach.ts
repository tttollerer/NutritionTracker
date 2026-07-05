import { z } from 'zod'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import {
  COACH_SENTINEL,
  CoachSuggestionsSchema,
  extractCoachStreamError,
} from './apiContract'
import { ApiError, apiErrorFromResponse, isOffline, toApiError } from './apiError'
import { sumsByDate } from './gamification'
import { computeDayNutrition, rankDeficits } from './deficit'
import { trend } from './measurements'
import { todayKey } from './utils'

/** Vertrags-Schema (apiContract.ts v1.1) unter dem bisherigen Namen re-exportiert. */
export const CoachSuggestions = CoachSuggestionsSchema
export const CoachResult = z.object({ reply: z.string(), suggestions: CoachSuggestions.optional() })

export type CoachResult = z.infer<typeof CoachResult>
export type CoachSuggestions = z.infer<typeof CoachSuggestionsSchema>
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

  // Körper-Verlauf: jüngstes Gewicht + Wochenrate (für adaptive Steuerung statt Formel).
  const weightSeries = await db.measurements.where('type').equals('weight').filter((m) => !m.deletedAt).toArray()
  const wTrend = trend(weightSeries, today)
  const body = wTrend ? { weightKg: wTrend.latest, weeklyRateKg: Math.round(wTrend.ratePerWeek * 100) / 100 } : null

  // Mahlzeitenverteilung + Tageszeit (für Timing-Beratung, z. B. Protein gleichmäßig verteilen).
  const todayLogs = logs.filter((l) => l.date === today && !l.deletedAt)
  const meals = (['breakfast', 'lunch', 'dinner', 'snack'] as const)
    .map((m) => {
      const items = todayLogs.filter((l) => l.meal === m)
      return { meal: m, kcal: Math.round(items.reduce((a, l) => a + l.computed.kcal, 0)), protein: Math.round(items.reduce((a, l) => a + l.computed.protein, 0)) }
    })
    .filter((x) => x.kcal > 0)
  const now = { hour: new Date().getHours() }

  return {
    profile: profile
      ? { persona: profile.persona, dietForms: profile.dietForms, goal: profile.goal, weightKg: body?.weightKg ?? profile.weightKg }
      : null,
    goals,
    today: todaySums,
    weekAvg,
    deficits, // "noch X bis Ziel" je Nährstoff
    limitsOver, // überschrittene Limits (Zucker/Salz/Koffein/Alkohol)
    glucose,
    body, // jüngstes Gewicht + Veränderung pro Woche (kg)
    meals, // heutige Mahlzeiten mit kcal + Protein (Verteilung/Timing)
    now, // aktuelle Tageszeit (Stunde)
  }
}

export async function getMemory() {
  return db.coachMemory.get('me')
}

/** Trenner zwischen Antworttext und Vorschlags-JSON (gestreamt) — aus dem Vertrag. */
export { COACH_SENTINEL }

/** Beginn eines Stream-Fehler-Events (Vertrag §3, extractCoachStreamError). */
const STREAM_ERROR_MARKER = 'event: error'

/** Anzeigbarer Teil des (Teil-)Streams: vor Vorschlags-Trenner und Fehler-Event. */
function visiblePart(streamed: string): string {
  let cut = streamed.length
  const s = streamed.indexOf(COACH_SENTINEL)
  if (s >= 0) cut = Math.min(cut, s)
  const e = streamed.startsWith(STREAM_ERROR_MARKER)
    ? 0
    : streamed.indexOf(`\n${STREAM_ERROR_MARKER}`)
  if (e >= 0) cut = Math.min(cut, e)
  return streamed.slice(0, cut).trimStart()
}

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
 *
 * Fehler kommen IMMER als typisierter ApiError (Anzeige über `t(err.i18nKey)`).
 * Ein Fehler-Event MITTEN im Stream (Vertrag §3) beendet den Stream mit einem
 * ApiError, dessen `partialReply` den bereits gestreamten Text erhält.
 */
export async function sendCoachStream(
  messages: ChatMessage[],
  onReply: (replySoFar: string) => void,
): Promise<CoachResult> {
  if (isOffline()) throw new ApiError('OFFLINE')

  const [context, memory] = await Promise.all([buildCoachContext(), getMemory()])
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
        context,
        memory: memory ? { diet: memory.diet, allergies: memory.allergies, likes: memory.likes, dislikes: memory.dislikes, tone: memory.tone } : null,
      }),
    })
  } catch (e) {
    throw toApiError(e) // Netzwerkfehler → OFFLINE statt kryptischem TypeError
  }

  if (!res.ok) throw await apiErrorFromResponse(res)
  if (!res.body) throw new ApiError('GENERIC')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    full += decoder.decode(value, { stream: true })
    onReply(visiblePart(full))
  }
  full += decoder.decode()

  // Fehler-Event aus dem Stream filtern (Vertrag §3) und wie einen HTTP-Fehler behandeln.
  const { text, error } = extractCoachStreamError(full)
  const idx = text.indexOf(COACH_SENTINEL)
  const reply = (idx >= 0 ? text.slice(0, idx) : text).trim()
  if (error) throw new ApiError(error.code, error.error, reply)

  const suggestions = idx >= 0 ? parseSuggestions(text.slice(idx + COACH_SENTINEL.length)) : undefined
  return { reply, suggestions }
}
