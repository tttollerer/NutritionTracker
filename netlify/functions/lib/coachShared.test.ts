import { describe, it, expect } from 'vitest'
import {
  API_ERROR_STATUS,
  ApiErrorSchema,
  COACH_SENTINEL,
  extractCoachStreamError,
  encodeCoachStreamError,
} from '../../../src/lib/apiContract'
import {
  buildUpstreamMessages,
  coachError,
  createSuggestionsFilter,
  errorResponse,
  isAbortError,
  parseCoachRequest,
  validateSuggestionsLine,
} from './coachShared'

const MSG = [{ role: 'user' as const, content: 'Hallo Coach' }]

describe('parseCoachRequest (CoachRequestSchema v1.1)', () => {
  it('akzeptiert memory:null und context:null (nullish, Vertrag §3)', () => {
    const r = parseCoachRequest(JSON.stringify({ messages: MSG, context: null, memory: null }))
    expect(r.ok).toBe(true)
  })

  it('akzeptiert fehlendes memory/context', () => {
    const r = parseCoachRequest(JSON.stringify({ messages: MSG }))
    expect(r.ok).toBe(true)
  })

  it('akzeptiert optionales imageBase64 (Foto-Feedback v1.1)', () => {
    const r = parseCoachRequest(JSON.stringify({ messages: MSG, memory: null, imageBase64: 'abc123' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.imageBase64).toBe('abc123')
  })

  it('lehnt leere messages mit INVALID_REQUEST-Envelope ab', () => {
    const r = parseCoachRequest(JSON.stringify({ messages: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_REQUEST')
      expect(ApiErrorSchema.safeParse(r.error).success).toBe(true)
    }
  })

  it('lehnt kaputtes JSON ab, ohne Rohdetails preiszugeben', () => {
    const r = parseCoachRequest('{nope')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_REQUEST')
      expect(r.error.error).not.toContain('nope')
    }
  })
})

describe('Fehler-Envelope (Vertrag §1)', () => {
  it('coachError baut einen gültigen Envelope mit deutschem Text', () => {
    const e = coachError('UPSTREAM_TIMEOUT')
    expect(ApiErrorSchema.safeParse(e).success).toBe(true)
    expect(e.error.length).toBeGreaterThan(0)
  })

  it('errorResponse nutzt das kanonische Status-Mapping', async () => {
    for (const code of ['INVALID_REQUEST', 'PAYLOAD_TOO_LARGE', 'UPSTREAM_ERROR', 'UPSTREAM_TIMEOUT'] as const) {
      const res = errorResponse(code)
      expect(res.status).toBe(API_ERROR_STATUS[code])
      const body = ApiErrorSchema.parse(await res.json())
      expect(body.code).toBe(code)
    }
  })

  it('errorResponse erlaubt Status-Override (405 → INVALID_REQUEST, Vertrag §1¹)', async () => {
    const res = errorResponse('INVALID_REQUEST', 405)
    expect(res.status).toBe(405)
    expect((await res.json()).code).toBe('INVALID_REQUEST')
  })
})

describe('validateSuggestionsLine (Vertrag §3: serverseitige Validierung)', () => {
  const valid = { goals: [{ nutrient: 'protein', type: 'min', target: 120, unit: 'g' }] }

  it('liefert für gültige Suggestions eine normalisierte JSON-Zeile', () => {
    const out = validateSuggestionsLine(`\n${JSON.stringify(valid)}\n`)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toEqual(valid)
  })

  it('toleriert Markdown-Zäune um das JSON', () => {
    const out = validateSuggestionsLine('```json\n' + JSON.stringify(valid) + '\n```')
    expect(out).not.toBeNull()
  })

  it('verwirft kaputtes JSON', () => {
    expect(validateSuggestionsLine('{"goals": [ kaputt')).toBeNull()
  })

  it('verwirft Schema-Verstöße (target als String)', () => {
    expect(
      validateSuggestionsLine('{"goals":[{"nutrient":"protein","type":"min","target":"viel","unit":"g"}]}'),
    ).toBeNull()
  })

  it('verwirft Leerstring', () => {
    expect(validateSuggestionsLine('   ')).toBeNull()
  })
})

describe('createSuggestionsFilter (Streaming)', () => {
  const suggestions = '{"challenges":[{"title":"5 Portionen Gemüse","period":"day"}]}'

  function run(chunks: string[]): { streamed: string; dropped: boolean } {
    const f = createSuggestionsFilter()
    let streamed = ''
    for (const c of chunks) streamed += f.push(c)
    const fin = f.finish()
    return { streamed: streamed + fin.text, dropped: fin.dropped }
  }

  it('reicht Text ohne Sentinel unverändert durch', () => {
    const r = run(['Iss mehr ', 'Protein.', ' Weiter so!'])
    expect(r.streamed).toBe('Iss mehr Protein. Weiter so!')
    expect(r.dropped).toBe(false)
  })

  it('reicht gültige Suggestions nach Validierung weiter — auch bei Sentinel über Chunk-Grenzen', () => {
    const r = run(['Guter Tag!\n###SUG', 'GESTIONS###\n', suggestions.slice(0, 10), suggestions.slice(10)])
    expect(r.streamed).toBe(`Guter Tag!\n${COACH_SENTINEL}\n${suggestions}`)
    expect(r.dropped).toBe(false)
  })

  it('verwirft kaputte Suggestions komplett — der Text bleibt sauber', () => {
    const r = run(['Guter Tag!\n', `${COACH_SENTINEL}\n{"goals": [ kaputt`])
    expect(r.streamed).toBe('Guter Tag!\n')
    expect(r.streamed).not.toContain(COACH_SENTINEL)
    expect(r.dropped).toBe(true)
  })

  it('flusht am Ende zurückgehaltene Sentinel-Präfix-Zeichen als normalen Text', () => {
    const r = run(['Wichtig: ###Tipp'])
    expect(r.streamed).toBe('Wichtig: ###Tipp')
    expect(r.dropped).toBe(false)
  })
})

describe('buildUpstreamMessages (Foto-Feedback v1.1)', () => {
  it('hängt das Bild als image_url an die letzte User-Nachricht (Data-URL wie analyze)', () => {
    const msgs = buildUpstreamMessages(
      {
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hallo!' },
          { role: 'user', content: 'Was hältst du davon?' },
        ],
        imageBase64: 'QUJD',
      },
      'SYSTEM',
    )
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYSTEM' })
    expect(msgs[1].content).toBe('Hi')
    expect(msgs[2].content).toBe('Hallo!')
    expect(msgs[3].content).toEqual([
      { type: 'text', text: 'Was hältst du davon?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
    ])
  })

  it('übernimmt eine vorhandene Data-URL unverändert', () => {
    const msgs = buildUpstreamMessages(
      { messages: [{ role: 'user', content: 'Foto' }], imageBase64: 'data:image/png;base64,QUJD' },
      'S',
    )
    expect(msgs[1].content).toEqual([
      { type: 'text', text: 'Foto' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ])
  })

  it('lässt Nachrichten ohne Bild als reine Strings', () => {
    const msgs = buildUpstreamMessages({ messages: [{ role: 'user', content: 'Hi' }] }, 'S')
    expect(msgs).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Hi' },
    ])
  })
})

describe('Stream-Fehler-Event (Vertrag §3, Roundtrip mit apiContract)', () => {
  it('encodeCoachStreamError-Ausgabe ist per extractCoachStreamError wieder entfernbar', () => {
    const streamed = 'Bis hierhin gestreamter Text.' + encodeCoachStreamError(coachError('UPSTREAM_TIMEOUT'))
    const { text, error } = extractCoachStreamError(streamed)
    // Der Event-Block endet mit Leerzeile — nach dem Entfernen darf höchstens
    // Whitespace übrig bleiben (der Client trimmt den Antworttext ohnehin).
    expect(text.trimEnd()).toBe('Bis hierhin gestreamter Text.')
    expect(error).toEqual(coachError('UPSTREAM_TIMEOUT'))
  })
})

describe('isAbortError', () => {
  it('erkennt TimeoutError/AbortError (AbortSignal.timeout)', () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError')
    const abort = new DOMException('Aborted', 'AbortError')
    expect(isAbortError(timeout)).toBe(true)
    expect(isAbortError(abort)).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError('nope')).toBe(false)
  })
})
