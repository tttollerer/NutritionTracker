import { z } from 'zod'

/**
 * KI-Ernährungscoach (PLAN.md §9.3). Textbasiert, bekommt eine aggregierte
 * Zusammenfassung (Profil, Ziele, Tages-/Wochenwerte, Defizite) + Gedächtnis
 * (Diätform/Allergien/Ton) und gibt Beratung sowie bestätigungspflichtige
 * Vorschläge (Ziele/Challenges/Log) als strukturiertes JSON zurück.
 *
 * Secrets (nur in Netlify-Env): OPENROUTER_API_KEY, optional OPENROUTER_MODEL.
 */

const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'
const MAX_BODY_BYTES = 256 * 1024

const Message = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })

const RequestSchema = z.object({
  messages: z.array(Message).min(1).max(40),
  context: z.record(z.unknown()).optional(),
  memory: z.record(z.unknown()).optional(),
})

const GoalSuggestion = z.object({
  nutrient: z.string(),
  type: z.enum(['min', 'max', 'range']),
  target: z.number(),
  targetMax: z.number().optional(),
  unit: z.string(),
  reason: z.string().optional(),
})
const ChallengeSuggestion = z.object({ title: z.string(), period: z.enum(['day', 'week']) })
const LogSuggestion = z.object({
  name: z.string(),
  amount: z.number(),
  unit: z.enum(['g', 'ml', 'portion']),
  per100: z.object({
    kcal: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})
const Result = z.object({
  reply: z.string(),
  suggestions: z
    .object({
      goals: z.array(GoalSuggestion).optional(),
      challenges: z.array(ChallengeSuggestion).optional(),
      logs: z.array(LogSuggestion).optional(),
    })
    .optional(),
})

function systemPrompt(context: unknown, memory: unknown): string {
  return [
    'Du bist ein erfahrener, motivierender Ernährungscoach in einer Tracking-App. Antworte auf Deutsch, freundlich und konkret, in wenigen Sätzen.',
    'Du kennst dich mit Zielgruppen aus: Kraftsport/Bodybuilding, Ausdauer, Ab-/Zunehmen, sowie Ernährungsformen wie vegan, vegetarisch, Low Carb/Keto, High Protein.',
    'Beziehe Profil, Ziele und die heutigen/wöchentlichen Werte ein. Schlage bei Bedarf passende Ziele, Challenges oder Log-Einträge vor — diese werden dem Nutzer nur als Vorschlag angezeigt und von ihm bestätigt.',
    'Berücksichtige hinterlegte Allergien/Unverträglichkeiten strikt und schlage niemals Lebensmittel vor, die diese enthalten.',
    'Gib keine medizinische Beratung. Bei sehr niedrigen Kalorienzielen oder Anzeichen für gestörtes Essverhalten reagiere vorsichtig und unterstützend und verweise ggf. auf Fachleute.',
    `KONTEXT (aggregiert): ${JSON.stringify(context ?? {})}`,
    `GEDÄCHTNIS: ${JSON.stringify(memory ?? {})}`,
    'Antworte AUSSCHLIESSLICH mit JSON: {"reply": string, "suggestions"?: {"goals"?: [{"nutrient":string,"type":"min"|"max"|"range","target":number,"targetMax"?:number,"unit":string,"reason"?:string}], "challenges"?: [{"title":string,"period":"day"|"week"}], "logs"?: [{"name":string,"amount":number,"unit":"g"|"ml"|"portion","per100":{"kcal":number,"protein":number,"carbs":number,"fat":number}}]}}. Lass suggestions weg, wenn es nichts vorzuschlagen gibt.',
  ].join('\n')
}

function extractJson(content: string): unknown {
  const t = content.trim().replace(/^```json\s*/i, '').replace(/```$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1))
    throw new Error('Antwort enthielt kein gültiges JSON')
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return json({ error: 'OPENROUTER_API_KEY nicht gesetzt' }, 500)

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Anfrage zu groß' }, 413)

  let parsed: z.infer<typeof RequestSchema>
  try {
    parsed = RequestSchema.parse(JSON.parse(raw))
  } catch {
    return json({ error: 'Ungültige Anfrage' }, 400)
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL
  const messages = [
    { role: 'system', content: systemPrompt(parsed.context, parsed.memory) },
    ...parsed.messages,
  ]

  try {
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages }),
        })
        if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`)
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        const content = data.choices?.[0]?.message?.content ?? ''
        return json(Result.parse(extractJson(content)), 200)
      } catch (e) {
        lastErr = e
      }
    }
    return json({ error: String(lastErr) }, 502)
  } catch (e) {
    return json({ error: String(e) }, 502)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export const config = { path: '/api/coach' }
