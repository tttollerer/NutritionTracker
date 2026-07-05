import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import handler from '../coach.mts'
import { ApiErrorSchema, COACH_SENTINEL, extractCoachStreamError } from '../../../src/lib/apiContract'

/**
 * End-to-End-Tests der Coach-Function (API_CONTRACT.md §1/§3) mit gemocktem
 * OpenRouter-Fetch. Liegt in lib/, damit Netlify die Datei nicht als eigene
 * Function deployt.
 */

function coachRequest(body: unknown): Request {
  return new Request('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** OpenRouter-SSE-Antwort aus Token-Deltas bauen. */
function sseResponse(deltas: string[]): Response {
  const payload =
    deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`).join('') +
    'data: [DONE]\n\n'
  return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** SSE-Antwort, die nach einem Token mitten im Stream abbricht. */
function brokenSseResponse(firstDelta: string): Response {
  const encoder = new TextEncoder()
  let step = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (step++ === 0) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: firstDelta } }] })}\n\n`),
        )
      } else {
        controller.error(new Error('upstream boom: secret detail'))
      }
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const VALID_BODY = { messages: [{ role: 'user', content: 'Hallo' }], context: null, memory: null }

describe('coach.mts (Function-Verhalten, Vertrag v1.1)', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('memory:null + context:null → 200 mit gestreamtem Text (v1.0-Bug behoben)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['Hallo', ' zurück!'])))
    const res = await handler(coachRequest(VALID_BODY))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hallo zurück!')
  })

  it('405 bei falscher Methode — Envelope mit INVALID_REQUEST', async () => {
    const res = await handler(new Request('http://localhost/api/coach', { method: 'GET' }))
    expect(res.status).toBe(405)
    const body = ApiErrorSchema.parse(await res.json())
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('Schema-Verstoß → 400 INVALID_REQUEST-Envelope', async () => {
    const res = await handler(coachRequest({ messages: [] }))
    expect(res.status).toBe(400)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('INVALID_REQUEST')
  })

  it('fehlender API-Key → 500 UPSTREAM_ERROR ohne ENV-Namen im Body', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const res = await handler(coachRequest(VALID_BODY))
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
    const res = await handler(coachRequest(VALID_BODY))
    expect(res.status).toBe(502)
    const raw = await res.text()
    expect(raw).not.toContain('secret failure')
    expect(ApiErrorSchema.parse(JSON.parse(raw)).code).toBe('UPSTREAM_ERROR')
  })

  it('Timeout beim Upstream-Fetch → 504 UPSTREAM_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError')),
    )
    const res = await handler(coachRequest(VALID_BODY))
    expect(res.status).toBe(504)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('UPSTREAM_TIMEOUT')
  })

  it('gültige Suggestions passieren die serverseitige Validierung', async () => {
    const suggestions = '{"challenges":[{"title":"10.000 Schritte","period":"day"}]}'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['Guter Plan!', `\n${COACH_SENTINEL}\n`, suggestions])),
    )
    const res = await handler(coachRequest(VALID_BODY))
    const text = await res.text()
    expect(text).toContain('Guter Plan!')
    expect(text).toContain(COACH_SENTINEL)
    expect(text).toContain('"10.000 Schritte"')
  })

  it('kaputte Suggestions werden verworfen — kein Sentinel, kein kaputtes JSON im Stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['Guter Plan!', `\n${COACH_SENTINEL}\n`, '{"goals": [ kaputt'])),
    )
    const res = await handler(coachRequest(VALID_BODY))
    const text = await res.text()
    expect(text.trimEnd()).toBe('Guter Plan!')
    expect(text).not.toContain(COACH_SENTINEL)
    expect(text).not.toContain('kaputt')
  })

  it('Stream-Abbruch → error-Event statt "[Fehler: …]"-Text, ohne Rohfehler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenSseResponse('Bis hier')))
    const res = await handler(coachRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const raw = await res.text()
    expect(raw).not.toContain('[Fehler:')
    expect(raw).not.toContain('secret detail')
    const { text, error } = extractCoachStreamError(raw)
    expect(text.trimEnd()).toBe('Bis hier')
    expect(error?.code).toBe('UPSTREAM_ERROR')
  })

  it('imageBase64 geht als image_url-Content an den Upstream (Foto-Feedback)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['Sieht gut aus!']))
    vi.stubGlobal('fetch', fetchMock)
    const res = await handler(coachRequest({ ...VALID_BODY, imageBase64: 'QUJD' }))
    expect(await res.text()).toBe('Sieht gut aus!')
    const upstreamBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    const userMsg = upstreamBody.messages[upstreamBody.messages.length - 1]
    expect(userMsg.content).toEqual([
      { type: 'text', text: 'Hallo' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
    ])
    // System-Prompt enthält die Foto-Feedback-Anweisung nur bei Bild.
    expect(upstreamBody.messages[0].content).toContain('FOTO')
  })

  it('Body über 256 KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await handler(coachRequest({ ...VALID_BODY, imageBase64: 'x'.repeat(300 * 1024) }))
    expect(res.status).toBe(413)
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
  })
})
