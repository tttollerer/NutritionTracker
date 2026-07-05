import { AnalyzeResultSchema } from '../../src/lib/apiContract'
import { analyzeErrorResponse, extractJson, parseAnalyzeRequest } from './lib/analyzeShared'
import { isAbortError } from './lib/coachShared'
import { createGuard } from './lib/guard'

/**
 * OpenRouter-Proxy für die Bildanalyse (PLAN.md §6, API_CONTRACT.md §1/§2,
 * v1.1). Versteckt den API-Key serverseitig, baut den modus-spezifischen
 * Prompt, erzwingt strukturiertes JSON und validiert es mit zod, bevor es zum
 * Client geht. Modell per ENV austauschbar.
 *
 * Fehler: immer Envelope { error, code } (Vertrag §1). Upstream-Rohtexte
 * (OpenRouter-Body, String(e)) gehen nur in console.error, nie in Antworten.
 * Schutzschichten (Origin, Body-Limit, Rate-Limit, Tagesbudget): lib/guard.ts.
 *
 * Secrets (nur in Netlify-Env): OPENROUTER_API_KEY, optional OPENROUTER_MODEL,
 * ALLOWED_ORIGIN, DAILY_BUDGET.
 */

// Vertrag §1 (Paket 3): 6 MB statt 8 MB — bleibt unter dem 6-MB-Sync-Limit
// von Netlify Functions; das client-seitig auf ~1024 px verkleinerte JPEG
// liegt ohnehin weit darunter.
const MAX_BODY_BYTES = 6 * 1024 * 1024
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'
const UPSTREAM_TIMEOUT_MS = 20_000

const guard = createGuard({ name: 'analyze', maxBodyBytes: MAX_BODY_BYTES })

const SYSTEM: Record<string, string> = {
  meal: 'Du bist ein Ernährungs-Erkennungssystem. Erkenne die Lebensmittel auf dem Foto und schätze die gegessene Menge. Gib für jedes Lebensmittel realistische Nährwerte je 100 g/ml an. Mengen sind Schätzungen — setze confidence entsprechend.',
  portion:
    'Schätze die Menge des abgebildeten Lebensmittels so genau wie möglich. Gib ein Item mit geschätzter Menge und Nährwerten je 100 g/ml zurück.',
  label:
    'Lies die abfotografierte Nährwerttabelle exakt aus. Diese Herstellerangaben sind Fakten, keine Schätzung — übernimm jeden dort aufgedruckten Wert exakt und vollständig (u. a. Brennwert/kcal, Fett, gesättigte Fettsäuren, Kohlenhydrate, Zucker, Ballaststoffe, Eiweiß, Salz sowie alle weiteren aufgeführten Nährstoffe wie Vitamine/Mineralstoffe) und runde oder schätze NICHTS davon selbst. Rechne „Salz" (g) in Natrium (mg) um: Natrium = Salz × 400. Falls mehrere Fotos vorliegen, nutze das Produktfoto nur zur Identifikation (Name, Marke) — die Nährwerttabelle ist immer die primäre Quelle für alle Zahlenwerte. Setze confidence auf 1.0, wenn die Werte direkt von einem lesbaren Etikett stammen, sonst niedriger. Gib die Werte je 100 g/ml zurück (per100) sowie die Portionsgröße als amount, falls angegeben (sonst 100).',
}

// Mikronährstoff-Schlüssel + Einheiten (deckungsgleich mit src/lib/nutrients.ts).
const MICRO_INSTRUCTION =
  'Ergänze in per100 zusätzlich ein Objekt "micros" mit Mikronährstoffen je 100 g/ml. Ist eine Nährwerttabelle sichtbar, übernimm ALLE dort aufgedruckten passenden Werte exakt (nicht nur schätzen); ansonsten schätze plausible Werte für typische Lebensmittel dieser Art (unbekannte weglassen). Erlaubte Schlüssel und Einheiten: fiber (g), sugar (g), satFat (g), sodium (mg), iron (mg), calcium (mg), magnesium (mg), zinc (mg), potassium (mg), vitaminC (mg), vitaminD (µg), vitaminB12 (µg), omega3 (g).'

const JSON_INSTRUCTION =
  'Antworte AUSSCHLIESSLICH mit JSON in genau diesem Schema: {"items":[{"name":string,"amount":number,"unit":"g"|"ml"|"portion","confidence":number(0..1),"per100":{"kcal":number,"protein":number,"carbs":number,"fat":number,"micros":{[key]:number}?}}],"notes":string?}. ' +
  MICRO_INSTRUCTION +
  ' Keine Erklärungen, kein Markdown.'

async function callOpenRouter(
  model: string,
  key: string,
  system: string,
  mode: string,
  images: string[],
  hint?: string,
) {
  const intro =
    images.length > 1
      ? mode === 'label'
        ? `Es folgen ${images.length} Fotos desselben Produkts: zuerst die Verpackung, danach die Nährwerttabelle(n). Kombiniere alle Informationen; die Nährwerttabelle hat für Zahlenwerte immer Vorrang.`
        : `Es folgen ${images.length} Fotos desselben Produkts/Gerichts. Kombiniere alle Informationen.`
      : 'Analysiere das Bild.'
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: hint ? `${intro} Hinweis: ${hint}` : intro },
  ]
  for (const img of images) {
    const dataUrl = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
    content.push({ type: 'image_url', image_url: { url: dataUrl } })
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\n${JSON_INSTRUCTION}` },
        { role: 'user', content },
      ],
    }),
    // Paket 3: hängender Upstream wird abgebrochen → UPSTREAM_TIMEOUT (504).
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) {
    // Rohtext NUR ins Server-Log (Vertrag §1) — der Client sieht den Envelope.
    const text = await res.text().catch(() => '')
    console.error(`analyze: OpenRouter ${res.status}: ${text.slice(0, 300)}`)
    throw new Error(`OpenRouter-Status ${res.status}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

export default async (req: Request): Promise<Response> => {
  // 405 behält den Status, trägt aber den INVALID_REQUEST-Envelope (Vertrag §1¹).
  if (req.method !== 'POST') return analyzeErrorResponse('INVALID_REQUEST', 405)

  // Schutzschicht 1–3: Origin (403) → Content-Length (413) → Rate-Limit (429),
  // alles bevor der Body überhaupt eingelesen wird.
  const blocked = guard.before(req)
  if (blocked) return blocked

  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    // Vertrag §1²: 500 + UPSTREAM_ERROR, keine ENV-Namen im Body.
    console.error('analyze: OPENROUTER_API_KEY nicht gesetzt')
    return analyzeErrorResponse('UPSTREAM_ERROR', 500)
  }

  const raw = await req.text()
  // Content-Length kann fehlen/lügen: Stringlänge VOR jedem Parse prüfen.
  const tooLarge = guard.bodyCheck(raw)
  if (tooLarge) return tooLarge

  const parsed = parseAnalyzeRequest(raw)
  if (!parsed.ok) return analyzeErrorResponse('INVALID_REQUEST')

  // Schutzschicht 4: Tagesbudget erst verbuchen, wenn der Request gültig ist
  // (ein Request = eine Budget-Einheit, auch mit internem Retry).
  const exhausted = guard.consumeBudget()
  if (exhausted) return exhausted

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL
  const system = SYSTEM[parsed.data.mode]

  // Ein Retry, falls das Modell mal kein sauberes JSON liefert; nach einem
  // Timeout wird NICHT erneut versucht (sonst wartet der Client bis zu 40 s).
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const images = [parsed.data.imageBase64, ...(parsed.data.images ?? [])]
      const content = await callOpenRouter(model, key, system, parsed.data.mode, images, parsed.data.hint)
      const result = AnalyzeResultSchema.parse(extractJson(content))
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (e) {
      lastErr = e
      if (isAbortError(e)) break
    }
  }
  // String(lastErr) nur ins Log — der Client bekommt ausschließlich den Envelope.
  console.error('analyze: Upstream fehlgeschlagen:', lastErr)
  return analyzeErrorResponse(isAbortError(lastErr) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR')
}

export const config = { path: '/api/analyze' }
