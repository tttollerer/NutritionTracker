import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiErrorSchema } from '../../../src/lib/apiContract'
import { RATE_LIMIT_MAX_REQUESTS } from './guard'

/**
 * End-to-End-Tests der Analyze-Function (API_CONTRACT.md §1/§2, Paket 3) mit
 * gemocktem OpenRouter-Fetch. Liegt in lib/, damit Netlify die Datei nicht als
 * eigene Function deployt.
 *
 * Die Function hält Rate-Limit-/Budget-Zähler im Modul-Scope — jeder Test lädt
 * das Modul deshalb frisch (vi.resetModules + dynamic import), damit sich die
 * Tests nicht gegenseitig limitieren.
 */

type Handler = (req: Request) => Promise<Response>

async function freshHandler(): Promise<Handler> {
  vi.resetModules()
  return (await import('../analyze.mts')).default as Handler
}

function analyzeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** OpenRouter-Chat-Completion-Antwort mit gegebenem content. */
function orResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_RESULT =
  '{"items":[{"name":"Apfel","amount":150,"unit":"g","confidence":0.9,"per100":{"kcal":52,"protein":0.3,"carbs":14,"fat":0.2}}]}'
const VALID_BODY = { mode: 'meal', imageBase64: 'QUJD' }

describe('analyze.mts (Function-Verhalten, Vertrag v1.1 + Paket 3)', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('gültiger Request → 200 mit validiertem Ergebnis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(orResponse(VALID_RESULT))))
    const handler = await freshHandler()
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { name: string }[] }
    expect(body.items[0].name).toBe('Apfel')
  })

  it('receipt-Modus → 200 mit sanitisiertem ReceiptResult (Vertrag v1.3)', async () => {
    // Modell liefert typischen Bon-Schmutz: krumme Stückzahl, ungerundeter Preis, halbes per100.
    const receiptContent = JSON.stringify({
      items: [
        { name: ' H-Milch 3,5 % ', quantity: 2.0, price: 2.379999, per100: { kcal: 64, protein: 3.4, carbs: 4.8, fat: 3.5 } },
        { name: 'Bananen', per100: { kcal: 89 } },
      ],
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(orResponse(receiptContent))))
    const handler = await freshHandler()
    const res = await handler(analyzeRequest({ mode: 'receipt', imageBase64: 'QUJD' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [
        { name: 'H-Milch 3,5 %', quantity: 2, price: 2.38, per100: { kcal: 64, protein: 3.4, carbs: 4.8, fat: 3.5 } },
        { name: 'Bananen', quantity: 1 },
      ],
    })
  })

  it('auto-Modus (Unified Scan v1.6): jedes kind kommt validiert beim Client an', async () => {
    const perKind: Record<string, string> = {
      meal: JSON.stringify({ kind: 'meal', items: [{ name: 'Linsensuppe', amount: 350, unit: 'ml', confidence: 0.7, per100: { kcal: 60, protein: 4, carbs: 8, fat: 1 } }], questions: ['Mit Sahne?'] }),
      label: JSON.stringify({ kind: 'label', items: [{ name: 'Skyr', amount: 150, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 } }], barcode: '4066 600 203704' }),
      barcode: JSON.stringify({ kind: 'barcode', items: [{ name: 'Unbekanntes Produkt', amount: 100, unit: 'g', per100: { kcal: 0, protein: 0, carbs: 0, fat: 0 } }], barcode: '40123455' }),
      receipt: JSON.stringify({ kind: 'receipt', items: [{ name: ' H-Milch 3,5 % ', quantity: 2.0, price: 2.379999 }] }),
    }
    for (const [kind, content] of Object.entries(perKind)) {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(orResponse(content))))
      const handler = await freshHandler()
      const res = await handler(analyzeRequest({ mode: 'auto', imageBase64: 'QUJD' }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { kind: string; items: unknown[]; barcode?: string }
      expect(body.kind).toBe(kind)
      expect(body.items).toHaveLength(1)
      // Sanitizing greift auch im auto-Modus (Barcode-Normalisierung, Bon-Clamps).
      if (kind === 'label') expect(body.barcode).toBe('4066600203704')
      if (kind === 'receipt') expect(body.items[0]).toEqual({ name: 'H-Milch 3,5 %', quantity: 2, price: 2.38 })
    }
  })

  it('auto-Modus ohne kind in der Modellantwort → Retry, dann 502 UPSTREAM_ERROR', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(orResponse(VALID_RESULT))) // gültig, aber ohne kind
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    const res = await handler(analyzeRequest({ mode: 'auto', imageBase64: 'QUJD' }))
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('UPSTREAM_ERROR')
  })

  it('405 bei falscher Methode — Envelope mit INVALID_REQUEST', async () => {
    const handler = await freshHandler()
    const res = await handler(new Request('http://localhost/api/analyze', { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('INVALID_REQUEST')
  })

  it('Schema-Verstoß (unbekannter Modus) → 400 INVALID_REQUEST-Envelope', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    const res = await handler(analyzeRequest({ mode: 'video', imageBase64: 'QUJD' }))
    expect(res.status).toBe(400)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('INVALID_REQUEST')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fehlender API-Key → 500 UPSTREAM_ERROR ohne ENV-Namen im Body', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const handler = await freshHandler()
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const raw = await res.text()
    expect(raw).not.toContain('OPENROUTER')
    expect(ApiErrorSchema.parse(JSON.parse(raw)).code).toBe('UPSTREAM_ERROR')
  })

  it('Upstream-HTTP-Fehler → 502 UPSTREAM_ERROR, Rohtext nur im Log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('OpenRouter secret failure detail', { status: 500 })),
    )
    const handler = await freshHandler()
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(502)
    const raw = await res.text()
    expect(raw).not.toContain('secret failure')
    expect(raw).not.toContain('OpenRouter')
    expect(ApiErrorSchema.parse(JSON.parse(raw)).code).toBe('UPSTREAM_ERROR')
  })

  it('dauerhaft kaputtes JSON → 1 Retry, dann 502 ohne String(e)-Rohtext', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(orResponse('geheimer kaputter inhalt ohne json')))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const raw = await res.text()
    expect(raw).not.toContain('geheimer kaputter inhalt')
    expect(raw).not.toContain('Error')
    expect(ApiErrorSchema.parse(JSON.parse(raw)).code).toBe('UPSTREAM_ERROR')
  })

  it('Timeout → 504 UPSTREAM_TIMEOUT, KEIN zweiter Versuch', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(504)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('UPSTREAM_TIMEOUT')
  })

  it('Content-Length über 6 MB → 413 VOR dem Einlesen, kein Upstream-Call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    const req = analyzeRequest(VALID_BODY, { 'content-length': String(7 * 1024 * 1024) })
    const res = await handler(req)
    expect(res.status).toBe(413)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    expect(req.bodyUsed).toBe(false) // Body wurde nie eingelesen
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Body über 6 MB ohne ehrlichen Content-Length → 413 vor dem Parse', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    const res = await handler(
      analyzeRequest({ ...VALID_BODY, imageBase64: 'x'.repeat(6 * 1024 * 1024 + 1) }),
    )
    expect(res.status).toBe(413)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Rate-Limit: nach 20 Requests derselben IP → 429 RATE_LIMITED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(orResponse(VALID_RESULT))))
    const handler = await freshHandler()
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      const res = await handler(analyzeRequest(VALID_BODY))
      expect(res.status).toBe(200)
    }
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(429)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('RATE_LIMITED')
  })

  it('Tagesbudget (DAILY_BUDGET) erschöpft → 402 BUDGET_EXCEEDED, kein Upstream-Call mehr', async () => {
    vi.stubEnv('DAILY_BUDGET', '2')
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(orResponse(VALID_RESULT)))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await freshHandler()
    expect((await handler(analyzeRequest(VALID_BODY))).status).toBe(200)
    expect((await handler(analyzeRequest(VALID_BODY))).status).toBe(200)
    const res = await handler(analyzeRequest(VALID_BODY))
    expect(res.status).toBe(402)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('BUDGET_EXCEEDED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Origin-Check: fremde/fehlende Origin → 403, erlaubte passiert', async () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://nutriscan.netlify.app')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(orResponse(VALID_RESULT))))
    const handler = await freshHandler()

    const evil = await handler(analyzeRequest(VALID_BODY, { origin: 'https://evil.example' }))
    expect(evil.status).toBe(403)
    expect(ApiErrorSchema.parse(await evil.json()).code).toBe('INVALID_REQUEST')

    const headless = await handler(analyzeRequest(VALID_BODY))
    expect(headless.status).toBe(403)

    const ok = await handler(analyzeRequest(VALID_BODY, { origin: 'https://nutriscan.netlify.app' }))
    expect(ok.status).toBe(200)
  })
})
