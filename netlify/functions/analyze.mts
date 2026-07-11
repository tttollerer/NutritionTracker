import { AnalyzeResultSchema, AutoAnalyzeResultSchema, ReceiptResultSchema } from '../../src/lib/apiContract'
import { analyzeErrorResponse, clampAuto, clampBarcode, clampQuestions, clampReceipt, extractJson, parseAnalyzeRequest } from './lib/analyzeShared'
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
    'Du bist ein Produkt-Scanner. Auf dem Foto ist eine Verpackung, eine Nährwerttabelle und/oder ein Strichcode. Lies eine sichtbare Nährwerttabelle exakt aus und gib die Werte je 100 g/ml zurück (per100) sowie die Portionsgröße als amount, falls angegeben (sonst 100). Ist KEINE Tabelle lesbar, schätze typische Nährwerte des erkennbaren Produkts und vermerke das in notes.',
  receipt:
    'Du bist ein Kassenbon-Parser für eine Ernährungs-App. Lies die Positionen des abfotografierten Kassenbons aus. Übernimm NUR Lebensmittel und Getränke — Pfand, Leergut, Rabatte, Tüten und Non-Food-Artikel lässt du weg. Normalisiere jeden Artikelnamen zu einem generischen deutschen Lebensmittelnamen ohne Marke und Händler-Kürzel (z. B. "JA! H-MILCH 3,5%" → "H-Milch 3,5 %"). Extrahiere je Position die ganze Stückzahl (Standard 1) und den Gesamtpreis der Position in EUR. Wenn du typische Nährwerte des Produkts sicher einschätzen kannst, gib sie je 100 g/ml als per100 an — sonst lasse per100 weg.',
  // v1.5: reine Text-Schätzung (kein Bild) — der Produktname steht im Hint.
  estimate:
    'Du bist eine Nährwert-Referenz für eine deutsche Ernährungs-App. Schätze für das GENANNTE Lebensmittel (siehe Hinweis) typische Nährwerte je 100 g bzw. 100 ml (Getränke/Flüssiges → ml). Gib genau EIN Item zurück: name = bereinigter deutscher Name, amount = übliche Portionsgröße in der Basis-Einheit (sonst 100), unit = g oder ml. Kurze Unsicherheiten (z. B. "je nach Rezept sehr unterschiedlich") gehören in notes.',
  // v1.6 (Unified Scan): EIN Modell-Aufruf klassifiziert und analysiert.
  auto:
    'Du bist der Scan-Assistent einer Ernährungs-App. Klassifiziere das Bild ZUERST: ' +
    'Ein zubereitetes Gericht bzw. eine Mahlzeit → kind "meal". ' +
    'Eine Produktverpackung und/oder Nährwerttabelle → kind "label". ' +
    'Ein Bild, das im Wesentlichen nur einen EAN/UPC-Strichcode zeigt → kind "barcode". ' +
    'Ein Kassenbon oder Einkaufszettel → kind "receipt". ' +
    'Liefere dann das zum kind passende Ergebnis im bekannten Format: ' +
    'Bei "meal" erkenne die Lebensmittel und schätze die gegessene Menge (realistische Nährwerte je 100 g/ml, confidence entsprechend der Unsicherheit). ' +
    'Bei "label" lies eine sichtbare Nährwerttabelle exakt aus (per100; Portionsgröße als amount, sonst 100) — ist keine Tabelle lesbar, schätze typische Nährwerte des erkennbaren Produkts und vermerke das in notes; ein sichtbarer Strichcode gehört zusätzlich ins barcode-Feld. ' +
    'Bei "barcode" gib die abgelesenen Ziffern als barcode zurück und schätze das Produkt als ein Item, so gut es geht. ' +
    'Bei "receipt" lies die Bon-Positionen aus: NUR Lebensmittel und Getränke (kein Pfand, keine Rabatte, keine Tüten, kein Non-Food), Artikelnamen zu generischen deutschen Lebensmittelnamen ohne Marke normalisieren (z. B. "JA! H-MILCH 3,5%" → "H-Milch 3,5 %"), je Position ganze Stückzahl (Standard 1) und Gesamtpreis in EUR; per100 nur, wenn du typische Nährwerte sicher einschätzen kannst.',
}

// Mikronährstoff-Schlüssel + Einheiten (deckungsgleich mit src/lib/nutrients.ts).
const MICRO_INSTRUCTION =
  'Schätze in per100 zusätzlich ein Objekt "micros" mit den Mikronährstoffen je 100 g/ml, die du sinnvoll einschätzen kannst (unbekannte weglassen). Erlaubte Schlüssel und Einheiten: fiber (g), sugar (g), satFat (g), sodium (mg), iron (mg), calcium (mg), magnesium (mg), zinc (mg), potassium (mg), vitaminC (mg), vitaminD (µg), vitaminB12 (µg), omega3 (g). Werte sind Schätzungen für typische Lebensmittel dieser Art.'

// Vertrag v1.4: Strichcode-Ziffern vom Bild ablesen — ersetzt den nativen
// BarcodeDetector (fehlt in iOS Safari); der Client macht den OFF-Lookup.
const BARCODE_INSTRUCTION =
  ' Wenn auf dem Bild ein EAN/UPC-Strichcode mit lesbaren Ziffern zu sehen ist, gib die Ziffern (ohne Leerzeichen) als "barcode" zurück — sonst lasse das Feld weg. Rate NIEMALS Ziffern.'

const JSON_INSTRUCTION =
  'Antworte AUSSCHLIESSLICH mit JSON in genau diesem Schema: {"items":[{"name":string,"amount":number,"unit":"g"|"ml"|"portion","confidence":number(0..1),"per100":{"kcal":number,"protein":number,"carbs":number,"fat":number,"micros":{[key]:number}?}}],"notes":string?,"questions":string[]?,"barcode":string?}. ' +
  MICRO_INSTRUCTION +
  BARCODE_INSTRUCTION +
  ' Keine Erklärungen, kein Markdown.'

// Kassenbon (Vertrag v1.3): eigenes Antwortschema — Positionen statt Mengen-Schätzung.
const RECEIPT_JSON_INSTRUCTION =
  'Antworte AUSSCHLIESSLICH mit JSON in genau diesem Schema: {"items":[{"name":string,"quantity":number,"price":number?,"per100":{"kcal":number,"protein":number,"carbs":number,"fat":number}?}]}. quantity ist die ganze Stückzahl der Position, price der Gesamtpreis der Position in EUR (Felder mit ? weglassen, wenn unbekannt). Keine Erklärungen, kein Markdown.'

// Unified Scan (Vertrag v1.6): bestehende Schemata, diskriminiert über "kind".
const AUTO_JSON_INSTRUCTION =
  'Antworte AUSSCHLIESSLICH mit JSON. Bei kind "meal", "label" oder "barcode" in genau diesem Schema: {"kind":"meal"|"label"|"barcode","items":[{"name":string,"amount":number,"unit":"g"|"ml"|"portion","confidence":number(0..1),"per100":{"kcal":number,"protein":number,"carbs":number,"fat":number,"micros":{[key]:number}?}}],"notes":string?,"questions":string[]?,"barcode":string?}. Bei kind "receipt" in genau diesem Schema: {"kind":"receipt","items":[{"name":string,"quantity":number,"price":number?,"per100":{"kcal":number,"protein":number,"carbs":number,"fat":number}?}]}. ' +
  MICRO_INSTRUCTION +
  BARCODE_INSTRUCTION +
  ' Rückfragen im Feld "questions" (max. 2) nur bei kind "meal", wenn eine Zusatzangabe die Schätzung deutlich verbessern würde. Keine Erklärungen, kein Markdown.'

// Verfeinerungsschleife (Vertrag v1.2, Paket B): nur meal/portion — bei einer
// abfotografierten Nährwerttabelle oder einem Kassenbon gibt es nichts nachzufragen.
const QUESTIONS_INSTRUCTION =
  ' Wenn eine Zusatzangabe die Schätzung deutlich verbessern würde (z. B. Saucen-Art wie "Joghurtsauce oder Mayo?", Zubereitungsart, verstecktes Fett), stelle bis zu 2 kurze Rückfragen im Feld "questions". Sonst lasse "questions" weg.'

async function callOpenRouter(model: string, key: string, system: string, imageBase64: string | undefined, hint?: string) {
  // v1.5 (estimate): ohne Bild geht nur der Text-Hinweis raus.
  const userContent: unknown[] = [
    { type: 'text', text: hint ? `Hinweis: ${hint}` : 'Analysiere das Bild.' },
  ]
  if (imageBase64) {
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
    userContent.push({ type: 'image_url', image_url: { url: dataUrl } })
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
        // `system` enthält bereits die modus-spezifische JSON-Instruktion.
        { role: 'system', content: system },
        { role: 'user', content: userContent },
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
  const mode = parsed.data.mode
  // Rückfragen nur bei den Schätz-Modi; receipt/auto bekommen ihr eigenes JSON-Schema.
  const system =
    mode === 'auto'
      ? SYSTEM.auto + '\n\n' + AUTO_JSON_INSTRUCTION
      : SYSTEM[mode] +
        (mode === 'meal' || mode === 'portion' ? QUESTIONS_INSTRUCTION : '') +
        '\n\n' +
        (mode === 'receipt' ? RECEIPT_JSON_INSTRUCTION : JSON_INSTRUCTION)

  // Ein Retry, falls das Modell mal kein sauberes JSON liefert; nach einem
  // Timeout wird NICHT erneut versucht (sonst wartet der Client bis zu 40 s).
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await callOpenRouter(model, key, system, parsed.data.imageBase64, parsed.data.hint)
      // clampQuestions/clampReceipt: Modell-Schmutz kappen, statt eine sonst
      // gültige Antwort an der Vertrags-Validierung scheitern zu lassen.
      const result =
        mode === 'auto'
          ? AutoAnalyzeResultSchema.parse(clampAuto(extractJson(content)))
          : mode === 'receipt'
            ? ReceiptResultSchema.parse(clampReceipt(extractJson(content)))
            : AnalyzeResultSchema.parse(clampQuestions(clampBarcode(extractJson(content))))
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
