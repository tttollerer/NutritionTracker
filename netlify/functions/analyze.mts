import { z } from 'zod'

/**
 * OpenRouter-Proxy (PLAN.md §6). Versteckt den API-Key serverseitig, baut den
 * modus-spezifischen Prompt, erzwingt strukturiertes JSON und validiert es mit
 * zod, bevor es zum Client geht. Modell per ENV austauschbar.
 *
 * Secrets (nur in Netlify-Env): OPENROUTER_API_KEY, optional OPENROUTER_MODEL.
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024 // ~8 MB (verkleinertes Bild ist klein)
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

const Item = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  unit: z.enum(['g', 'ml', 'portion']),
  confidence: z.number().min(0).max(1).optional(),
  per100: z.object({
    kcal: z.number().nonnegative(),
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
    // Optionale Mikronährstoff-Schätzung je 100 g/ml (Schlüssel = Nährstoff-Katalog).
    micros: z.record(z.number().nonnegative()).optional(),
  }),
})
const Result = z.object({ items: z.array(Item), notes: z.string().optional() })

const RequestSchema = z.object({
  mode: z.enum(['meal', 'label', 'portion']),
  imageBase64: z.string().min(1),
  hint: z.string().max(280).optional(),
})

const SYSTEM: Record<string, string> = {
  meal: 'Du bist ein Ernährungs-Erkennungssystem. Erkenne die Lebensmittel auf dem Foto und schätze die gegessene Menge. Gib für jedes Lebensmittel realistische Nährwerte je 100 g/ml an. Mengen sind Schätzungen — setze confidence entsprechend.',
  portion:
    'Schätze die Menge des abgebildeten Lebensmittels so genau wie möglich. Gib ein Item mit geschätzter Menge und Nährwerten je 100 g/ml zurück.',
  label:
    'Lies die abfotografierte Nährwerttabelle exakt aus. Gib die Werte je 100 g/ml zurück (per100) sowie die Portionsgröße als amount, falls angegeben (sonst 100).',
}

// Mikronährstoff-Schlüssel + Einheiten (deckungsgleich mit src/lib/nutrients.ts).
const MICRO_INSTRUCTION =
  'Schätze in per100 zusätzlich ein Objekt "micros" mit den Mikronährstoffen je 100 g/ml, die du sinnvoll einschätzen kannst (unbekannte weglassen). Erlaubte Schlüssel und Einheiten: fiber (g), sugar (g), satFat (g), sodium (mg), iron (mg), calcium (mg), magnesium (mg), zinc (mg), potassium (mg), vitaminC (mg), vitaminD (µg), vitaminB12 (µg), omega3 (g). Werte sind Schätzungen für typische Lebensmittel dieser Art.'

const JSON_INSTRUCTION =
  'Antworte AUSSCHLIESSLICH mit JSON in genau diesem Schema: {"items":[{"name":string,"amount":number,"unit":"g"|"ml"|"portion","confidence":number(0..1),"per100":{"kcal":number,"protein":number,"carbs":number,"fat":number,"micros":{[key]:number}?}}],"notes":string?}. ' +
  MICRO_INSTRUCTION +
  ' Keine Erklärungen, kein Markdown.'

async function callOpenRouter(model: string, key: string, system: string, imageBase64: string, hint?: string) {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
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
        {
          role: 'user',
          content: [
            { type: 'text', text: hint ? `Hinweis: ${hint}` : 'Analysiere das Bild.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Antwort enthielt kein gültiges JSON')
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return json({ error: 'OPENROUTER_API_KEY nicht gesetzt' }, 500)

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Bild zu groß' }, 413)

  let parsed: z.infer<typeof RequestSchema>
  try {
    parsed = RequestSchema.parse(JSON.parse(raw))
  } catch {
    return json({ error: 'Ungültige Anfrage' }, 400)
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL
  const system = SYSTEM[parsed.mode]

  try {
    // Ein Retry, falls das Modell mal kein sauberes JSON liefert.
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = await callOpenRouter(model, key, system, parsed.imageBase64, parsed.hint)
        const result = Result.parse(extractJson(content))
        return json(result, 200)
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/analyze' }
