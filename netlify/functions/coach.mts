import { encodeCoachStreamError } from '../../src/lib/apiContract'
import {
  buildUpstreamMessages,
  coachError,
  createSuggestionsFilter,
  errorResponse,
  isAbortError,
  parseCoachRequest,
} from './lib/coachShared'
import { createGuard } from './lib/guard'

/**
 * KI-Ernährungscoach (PLAN.md §9.3, API_CONTRACT.md §3, v1.1). Textbasiert,
 * bekommt eine aggregierte Zusammenfassung (Profil, Ziele, Tages-/Wochenwerte,
 * Defizite) + Gedächtnis (Diätform/Allergien/Ton), optional ein Foto
 * (Foto-Feedback) und gibt Beratung sowie bestätigungspflichtige Vorschläge
 * (Ziele/Challenges/Log) als serverseitig validiertes JSON zurück.
 *
 * Fehler: immer Envelope { error, code } (Vertrag §1); Stream-Abbrüche als
 * `event: error`-Block im 200er-Stream (Vertrag §3). Upstream-Rohtexte gehen
 * nur in console.error, nie in Antworten.
 * Schutzschichten (Origin, Body-Limit, Rate-Limit, Tagesbudget): lib/guard.ts.
 *
 * Secrets (nur in Netlify-Env): OPENROUTER_API_KEY, optional OPENROUTER_MODEL,
 * ALLOWED_ORIGIN, DAILY_BUDGET.
 */

const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'
const MAX_BODY_BYTES = 256 * 1024 // Vertrag §1: coach ≤ 256 KB (inkl. optionalem, klein skaliertem Foto)
const UPSTREAM_TIMEOUT_MS = 20_000

const guard = createGuard({ name: 'coach', maxBodyBytes: MAX_BODY_BYTES })

function systemPrompt(context: unknown, memory: unknown, hasImage: boolean): string {
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
    ...(hasImage
      ? [
          'Der letzten Nutzernachricht ist ein FOTO beigefügt (z. B. eine Mahlzeit oder ein Produkt). Gib konkretes, wertschätzendes Feedback zum abgebildeten Essen im Kontext der Ziele und heutigen Werte: Was passt gut, was ließe sich verbessern? Erfinde dabei keine exakten Nährwerte oder Mikronährwerte — bleibe bei groben, ehrlichen Einschätzungen. Passt das Gezeigte gut, kannst du es als Log-Vorschlag (logs) mit realistischen Schätzwerten vorschlagen.',
        ]
      : []),
    'Berücksichtige hinterlegte Allergien/Unverträglichkeiten strikt und schlage niemals Lebensmittel vor, die diese enthalten.',
    'Gib keine medizinische Beratung. Bei sehr niedrigen Kalorienzielen oder Anzeichen für gestörtes Essverhalten reagiere vorsichtig und unterstützend und verweise ggf. auf Fachleute.',
    `KONTEXT (aggregiert): ${JSON.stringify(context ?? {})}`,
    `GEDÄCHTNIS: ${JSON.stringify(memory ?? {})}`,
    'AUSGABEFORMAT: Antworte ZUERST mit deiner Beratung als normaler, gut vorlesbarer Text (kurze Sätze, kein Markdown, kein JSON).',
    'Wenn du Vorschläge hast, hänge DANACH in einer neuen Zeile exakt `###SUGGESTIONS###` an, gefolgt von genau einer Zeile JSON: {"goals"?: [{"nutrient":string,"type":"min"|"max"|"range","target":number,"targetMax"?:number,"unit":string,"reason"?:string}], "challenges"?: [{"title":string,"period":"day"|"week","rule"?:{"nutrient":string,"type":"min"|"max","target":number,"unit"?:string,"days"?:number}}], "logs"?: [{"name":string,"amount":number,"unit":"g"|"ml"|"portion","per100":{"kcal":number,"protein":number,"carbs":number,"fat":number}}]}.',
    'Für "nutrient" (in goals UND challenges.rule) sind AUSSCHLIESSLICH diese Werte erlaubt: "kcal", "protein", "carbs", "fat", "sugar", "fiber", "sodium". Ziele zu anderen Nährstoffen (z. B. Vitamine, Eisen) gibst du nur als Text-Tipp, NIE als goals-Vorschlag — sie würden verworfen.',
    'Gib Challenges WENN MÖGLICH eine messbare "rule" mit (target > 0; "days" 1–7 nur bei period "week" = geforderte Erfolgstage). Beispiel: {"title":"Protein-Woche","period":"week","rule":{"nutrient":"protein","type":"min","target":120,"unit":"g","days":5}}. Nur nicht messbare Challenges (z. B. "achtsam essen") lässt du ohne rule.',
    'Ohne Vorschläge lässt du Trenner und JSON komplett weg. Gib das Schema/JSON niemals im Beratungstext aus.',
  ].join('\n')
}

export default async (req: Request): Promise<Response> => {
  // 405 behält den Status, trägt aber den INVALID_REQUEST-Envelope (Vertrag §1¹).
  if (req.method !== 'POST') return errorResponse('INVALID_REQUEST', 405)

  // Schutzschicht 1–3 (Paket 3): Origin (403) → Content-Length (413) →
  // Rate-Limit (429), alles bevor der Body eingelesen wird.
  const blocked = guard.before(req)
  if (blocked) return blocked

  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    // Vertrag §1²: 500 + UPSTREAM_ERROR, keine ENV-Namen im Body.
    console.error('coach: OPENROUTER_API_KEY nicht gesetzt')
    return errorResponse('UPSTREAM_ERROR', 500)
  }

  const raw = await req.text()
  // Content-Length kann fehlen/lügen: Stringlänge VOR jedem Parse prüfen.
  if (raw.length > MAX_BODY_BYTES) return errorResponse('PAYLOAD_TOO_LARGE')

  const parsed = parseCoachRequest(raw)
  if (!parsed.ok) return errorResponse('INVALID_REQUEST')

  // Schutzschicht 4: Tagesbudget erst verbuchen, wenn der Request gültig ist.
  const exhausted = guard.consumeBudget()
  if (exhausted) return exhausted

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL
  const messages = buildUpstreamMessages(
    parsed.data,
    systemPrompt(parsed.data.context, parsed.data.memory, Boolean(parsed.data.imageBase64)),
  )

  let upstream: Response
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (e) {
    console.error('coach: OpenRouter-Fetch fehlgeschlagen:', e)
    return errorResponse(isAbortError(e) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR')
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    console.error(`coach: OpenRouter ${upstream.status}: ${detail.slice(0, 300)}`)
    return errorResponse('UPSTREAM_ERROR')
  }

  // OpenRouter-SSE in reinen Text-Token-Stream umwandeln. Die Suggestions-Zeile
  // (nach ###SUGGESTIONS###) wird serverseitig gepuffert, validiert und nur
  // gültig weitergereicht; Abbrüche gehen als error-Event in den Stream.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      // v1.2: einzeln verworfene Vorschläge (Ziel mit fremdem nutrient,
      // kaputte Challenge-rule) landen im Server-Log, nie beim Nutzer.
      const filter = createSuggestionsFilter((msg) => console.error(msg))
      const emit = (text: string) => {
        if (text) controller.enqueue(encoder.encode(text))
      }
      let buf = ''
      try {
        streaming: for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            const data = l.slice(5).trim()
            if (data === '[DONE]') break streaming
            try {
              const piece = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
              const delta = piece.choices?.[0]?.delta?.content
              if (delta) emit(filter.push(delta))
            } catch {
              /* Teil-Chunk / Keep-Alive ignorieren */
            }
          }
        }
        const fin = filter.finish()
        if (fin.dropped) console.error('coach: ungültige Suggestions-Zeile verworfen')
        emit(fin.text)
      } catch (e) {
        // Vertrag §3: error-Event statt "[Fehler: …]"-Text; Rohfehler nur ins Log.
        console.error('coach: Stream abgebrochen:', e)
        const fin = filter.finish()
        if (fin.dropped) console.error('coach: ungültige Suggestions-Zeile verworfen')
        emit(fin.text)
        emit(encodeCoachStreamError(coachError(isAbortError(e) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR')))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

export const config = { path: '/api/coach' }
