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

function systemPrompt(context: unknown, memory: unknown): string {
  // White-Label: Coach-Name/-Persönlichkeit pro Mandant über Server-ENV.
  const coachName = process.env.COACH_NAME?.trim()
  const coachPersona = process.env.COACH_PERSONA?.trim()
  const intro = coachName
    ? `Du bist ${coachName}, ein erfahrener, motivierender Ernährungscoach in einer Tracking-App. Antworte auf Deutsch, freundlich und konkret, in wenigen Sätzen.`
    : 'Du bist ein erfahrener, motivierender Ernährungscoach in einer Tracking-App. Antworte auf Deutsch, freundlich und konkret, in wenigen Sätzen.'
  return [
    intro,
    ...(coachPersona ? [`Deine Persönlichkeit/Tonalität: ${coachPersona}`] : []),
    'Du kennst dich mit Zielgruppen aus: Kraftsport/Bodybuilding, Ausdauer, Ab-/Zunehmen, sowie Ernährungsformen wie vegan, vegetarisch, Low Carb/Keto, High Protein.',
    'Beziehe Profil, Ziele und die heutigen/wöchentlichen Werte ein. Schlage bei Bedarf passende Ziele, Challenges oder Log-Einträge vor — diese werden dem Nutzer nur als Vorschlag angezeigt und von ihm bestätigt.',
    'Der Kontext enthält `deficits` (was heute je Nährstoff noch bis zum Ziel fehlt, inkl. Mikronährstoffe wie Eisen/B12/Calcium) und `limitsOver` (überschrittene Limits wie Zucker/Salz/Koffein/Alkohol). Nutze diese konkret: nenne die größten Defizite und empfiehl passende Lebensmittel, warne bei überschrittenen Limits.',
    'Enthält der Kontext `glucose` (Blutzucker), gehe bei sehr hohen/niedrigen Werten vorsichtig und unterstützend darauf ein — ohne medizinische Diagnose.',
    'Enthält der Kontext `body` (jüngstes Gewicht + `weeklyRateKg` = Veränderung pro Woche), steuere an der REALEN Veränderung statt an der Formel: passt die Wochenrate nicht zum Ziel (z. B. Abnehmen, aber Rate ~0 über Wochen), erkläre das und schlage eine moderate Anpassung vor. Eine gesunde Rate liegt grob bei 0,3–0,7 kg/Woche.',
    'Der Kontext enthält `meals` (heutige Mahlzeiten mit kcal + Protein) und `now.hour` (Tageszeit). Nutze das für Timing-Tipps: ist das Protein sehr ungleich verteilt oder sind je nach Uhrzeit noch Mahlzeiten offen, schlage eine gleichmäßigere Verteilung vor (Richtwert grob 0,3–0,4 g Protein pro kg je Mahlzeit).',
    'Berücksichtige hinterlegte Allergien/Unverträglichkeiten strikt und schlage niemals Lebensmittel vor, die diese enthalten.',
    'Gib keine medizinische Beratung. Bei sehr niedrigen Kalorienzielen oder Anzeichen für gestörtes Essverhalten reagiere vorsichtig und unterstützend und verweise ggf. auf Fachleute.',
    `KONTEXT (aggregiert): ${JSON.stringify(context ?? {})}`,
    `GEDÄCHTNIS: ${JSON.stringify(memory ?? {})}`,
    'AUSGABEFORMAT: Antworte ZUERST mit deiner Beratung als normaler, gut vorlesbarer Text (kurze Sätze, kein Markdown, kein JSON).',
    'Wenn du Vorschläge hast, hänge DANACH in einer neuen Zeile exakt `###SUGGESTIONS###` an, gefolgt von genau einer Zeile JSON: {"goals"?: [{"nutrient":string,"type":"min"|"max"|"range","target":number,"targetMax"?:number,"unit":string,"reason"?:string}], "challenges"?: [{"title":string,"period":"day"|"week"}], "logs"?: [{"name":string,"amount":number,"unit":"g"|"ml"|"portion","per100":{"kcal":number,"protein":number,"carbs":number,"fat":number}}]}.',
    'Ohne Vorschläge lässt du Trenner und JSON komplett weg. Gib das Schema/JSON niemals im Beratungstext aus.',
  ].join('\n')
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

  let upstream: Response
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages }),
    })
  } catch (e) {
    return json({ error: String(e) }, 502)
  }
  if (!upstream.ok || !upstream.body) {
    return json({ error: `OpenRouter ${upstream.status}: ${(await upstream.text()).slice(0, 200)}` }, 502)
  }

  // OpenRouter-SSE in reinen Text-Token-Stream umwandeln und an den Client durchreichen.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            const data = l.slice(5).trim()
            if (data === '[DONE]') {
              controller.close()
              return
            }
            try {
              const piece = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
              const delta = piece.choices?.[0]?.delta?.content
              if (delta) controller.enqueue(encoder.encode(delta))
            } catch {
              /* Teil-Chunk / Keep-Alive ignorieren */
            }
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n[Fehler: ${String(e)}]`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export const config = { path: '/api/coach' }
