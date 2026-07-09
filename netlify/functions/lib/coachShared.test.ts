import 'fake-indexeddb/auto' // src/lib/challenges importiert die Dexie-Instanz (@/db)
import { describe, it, expect, vi } from 'vitest'
import { parseChallengeRule } from '../../../src/lib/challenges'
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
  sanitizeSuggestions,
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

describe('sanitizeSuggestions (v1.2, Befund 4: Nutrient-Enum für Ziele)', () => {
  it('verwirft NUR das Ziel mit fremdem nutrient und loggt es — der Rest bleibt', () => {
    const warn = vi.fn()
    const out = sanitizeSuggestions(
      {
        goals: [
          { nutrient: 'vitaminC', type: 'min', target: 90, unit: 'mg' }, // nicht darstellbar → weg
          { nutrient: 'protein', type: 'min', target: 120, unit: 'g' },
        ],
        challenges: [{ title: '3x Gemüse', period: 'day' }],
      },
      warn,
    )
    expect(out).toEqual({
      goals: [{ nutrient: 'protein', type: 'min', target: 120, unit: 'g' }],
      challenges: [{ title: '3x Gemüse', period: 'day' }],
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('vitaminC')
  })

  it('erlaubt getrackte Limit-/Micro-Ziele (sugar/fiber/sodium)', () => {
    const out = sanitizeSuggestions({
      goals: [{ nutrient: 'sugar', type: 'max', target: 25, unit: 'g' }],
    })
    expect(out?.goals).toHaveLength(1)
  })

  it('liefert null, wenn nach dem Aufräumen nichts übrig ist', () => {
    const warn = vi.fn()
    expect(sanitizeSuggestions({ goals: [{ nutrient: 'salt', type: 'max', target: 6, unit: 'g' }] }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('sanitizeSuggestions (v1.2, Befund 8: Challenge-rule)', () => {
  const weekRule = { nutrient: 'protein', type: 'min', target: 120, unit: 'g', days: 5 }

  it('reicht eine gültige rule durch — und parseChallengeRule kann sie auswerten (Roundtrip)', () => {
    const out = sanitizeSuggestions({
      challenges: [{ title: 'Protein-Woche', period: 'week', rule: weekRule }],
    })
    expect(out?.challenges?.[0]).toEqual({ title: 'Protein-Woche', period: 'week', rule: weekRule })
    // Exakt das Format, das die Fortschritts-Engine (src/lib/challenges.ts) erwartet:
    expect(parseChallengeRule(out!.challenges![0].rule)).toEqual({
      nutrient: 'protein',
      type: 'min',
      target: 120,
      targetMax: undefined,
      unit: 'g',
      days: 5,
    })
  })

  it('kaputte rule → Challenge bleibt OHNE rule erhalten (manuell abschließbar), geloggt', () => {
    const warn = vi.fn()
    const out = sanitizeSuggestions(
      {
        challenges: [
          { title: 'Weniger Zucker', period: 'day', rule: { nutrient: 'zucker', type: 'max', target: 0 } },
        ],
      },
      warn,
    )
    expect(out?.challenges).toEqual([{ title: 'Weniger Zucker', period: 'day' }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('rule')
  })

  it('strippt days bei period "day" still, statt die rule zu opfern', () => {
    const out = sanitizeSuggestions({
      challenges: [
        { title: 'Protein heute', period: 'day', rule: { nutrient: 'protein', type: 'min', target: 30, days: 3 } },
      ],
    })
    expect(out?.challenges?.[0].rule).toEqual({ nutrient: 'protein', type: 'min', target: 30 })
  })

  it('Challenge ohne title/period wird verworfen, gültige daneben bleiben', () => {
    const warn = vi.fn()
    const out = sanitizeSuggestions(
      { challenges: [{ period: 'day' }, { title: 'Ok', period: 'week', rule: weekRule }] },
      warn,
    )
    expect(out?.challenges).toEqual([{ title: 'Ok', period: 'week', rule: weekRule }])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('validateSuggestionsLine nutzt die Rettung: gemischte Zeile kommt bereinigt an', () => {
    const warn = vi.fn()
    const line = JSON.stringify({
      goals: [
        { nutrient: 'iron', type: 'min', target: 12, unit: 'mg' },
        { nutrient: 'fiber', type: 'min', target: 30, unit: 'g' },
      ],
      challenges: [{ title: 'Ballaststoff-Woche', period: 'week', rule: { nutrient: 'fiber', type: 'min', target: 30, days: 4 } }],
    })
    const out = validateSuggestionsLine(line, warn)
    expect(out).not.toBeNull()
    const parsed = JSON.parse(out!)
    expect(parsed.goals).toEqual([{ nutrient: 'fiber', type: 'min', target: 30, unit: 'g' }])
    expect(parsed.challenges[0].rule).toEqual({ nutrient: 'fiber', type: 'min', target: 30, days: 4 })
    expect(warn).toHaveBeenCalledTimes(1) // nur das iron-Ziel
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
