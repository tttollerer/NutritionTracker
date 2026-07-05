import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  ApiErrorSchema,
  apiError,
  CoachRequestSchema,
  CoachSuggestionsSchema,
  encodeCoachStreamError,
  extractCoachStreamError,
} from './apiContract'

describe('ApiErrorSchema (Fehler-Envelope v1.1)', () => {
  it('akzeptiert jeden definierten Fehlercode mit Nutzertext', () => {
    for (const code of API_ERROR_CODES) {
      expect(ApiErrorSchema.parse({ error: 'Bitte später erneut versuchen.', code })).toEqual({
        error: 'Bitte später erneut versuchen.',
        code,
      })
    }
  })

  it('lehnt unbekannte Codes, fehlende Felder und leeren Text ab', () => {
    expect(ApiErrorSchema.safeParse({ error: 'x', code: 'OFFLINE' }).success).toBe(false)
    expect(ApiErrorSchema.safeParse({ error: 'x' }).success).toBe(false)
    expect(ApiErrorSchema.safeParse({ code: 'RATE_LIMITED' }).success).toBe(false)
    expect(ApiErrorSchema.safeParse({ error: '', code: 'RATE_LIMITED' }).success).toBe(false)
  })

  it('mappt jeden Code auf den kanonischen HTTP-Status', () => {
    expect(API_ERROR_STATUS).toEqual({
      INVALID_REQUEST: 400,
      BUDGET_EXCEEDED: 402,
      PAYLOAD_TOO_LARGE: 413,
      RATE_LIMITED: 429,
      UPSTREAM_ERROR: 502,
      UPSTREAM_TIMEOUT: 504,
    })
  })

  it('apiError() baut einen schema-gültigen Envelope', () => {
    expect(ApiErrorSchema.parse(apiError('RATE_LIMITED', 'Zu viele Anfragen.'))).toEqual({
      code: 'RATE_LIMITED',
      error: 'Zu viele Anfragen.',
    })
  })
})

describe('CoachRequestSchema (v1.1, memory/context nullish)', () => {
  const base = { messages: [{ role: 'user' as const, content: 'Hallo Coach' }] }

  it('Repro-Fall: memory:null muss gültig sein (heute 400 — coach.mts:20 vs src/lib/coach.ts:164)', () => {
    // Exakt der Body, den der Client für Nutzer OHNE CoachMemory sendet.
    const clientBody = { ...base, context: { today: { kcal: 0 } }, memory: null }
    const parsed = CoachRequestSchema.safeParse(clientBody)
    expect(parsed.success).toBe(true)
  })

  it('memory darf auch weggelassen oder ein Objekt sein', () => {
    expect(CoachRequestSchema.safeParse(base).success).toBe(true)
    expect(
      CoachRequestSchema.safeParse({ ...base, memory: { diet: 'vegan', allergies: ['nuts'] } }).success,
    ).toBe(true)
    expect(CoachRequestSchema.safeParse({ ...base, context: null }).success).toBe(true)
  })

  it('lehnt Nicht-Objekte für memory und leere messages weiter ab', () => {
    expect(CoachRequestSchema.safeParse({ ...base, memory: 'vegan' }).success).toBe(false)
    expect(CoachRequestSchema.safeParse({ messages: [] }).success).toBe(false)
  })

  it('erlaubt optionales imageBase64 (Coach-Foto-Feedback, v1.1)', () => {
    expect(CoachRequestSchema.safeParse({ ...base, imageBase64: 'data:image/jpeg;base64,AAA' }).success).toBe(true)
    expect(CoachRequestSchema.safeParse({ ...base, imageBase64: '' }).success).toBe(false)
  })

  it('Dokumentation des v1.0-Bugs: das heutige Server-Schema lehnt memory:null ab', () => {
    // Nachbau von netlify/functions/coach.mts:17-21 (Ist-Stand v1.0).
    const legacyServerSchema = z.object({
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(40),
      context: z.record(z.unknown()).optional(),
      memory: z.record(z.unknown()).optional(),
    })
    const clientBody = { ...base, context: {}, memory: null }
    expect(legacyServerSchema.safeParse(clientBody).success).toBe(false) // → heute HTTP 400
    expect(CoachRequestSchema.safeParse(clientBody).success).toBe(true) // → Soll v1.1: 200
  })
})

describe('CoachSuggestionsSchema (serverseitig zu validieren, v1.1)', () => {
  it('akzeptiert eine typische Vorschlags-Zeile', () => {
    const line = {
      goals: [{ nutrient: 'protein', type: 'min', target: 140, unit: 'g', reason: 'Muskelaufbau' }],
      challenges: [{ title: '3x Gemüse heute', period: 'day' }],
      logs: [{ name: 'Magerquark', amount: 250, unit: 'g', per100: { kcal: 67, protein: 12, carbs: 4, fat: 0.3 } }],
    }
    expect(CoachSuggestionsSchema.safeParse(line).success).toBe(true)
  })

  it('lehnt kaputte Zeilen ab (falsche unit, fehlendes per100)', () => {
    expect(
      CoachSuggestionsSchema.safeParse({ logs: [{ name: 'x', amount: 1, unit: 'Stück', per100: { kcal: 1, protein: 0, carbs: 0, fat: 0 } }] }).success,
    ).toBe(false)
    expect(CoachSuggestionsSchema.safeParse({ logs: [{ name: 'x', amount: 1, unit: 'g' }] }).success).toBe(false)
  })
})

describe('Coach-Stream-Fehler-Event (v1.1)', () => {
  it('encode → extract Roundtrip: Text bleibt, Envelope wird geparst', () => {
    const stream = 'Iss heute noch etwas Protein.' + encodeCoachStreamError(apiError('UPSTREAM_TIMEOUT', 'Zeitüberschreitung.'))
    const { text, error } = extractCoachStreamError(stream)
    expect(text).toBe('Iss heute noch etwas Protein.\n')
    expect(error).toEqual({ code: 'UPSTREAM_TIMEOUT', error: 'Zeitüberschreitung.' })
  })

  it('ohne Event-Block: Text unverändert, error null', () => {
    const { text, error } = extractCoachStreamError('Nur normale Beratung.\n###SUGGESTIONS###\n{"goals":[]}')
    expect(text).toBe('Nur normale Beratung.\n###SUGGESTIONS###\n{"goals":[]}')
    expect(error).toBeNull()
  })

  it('kaputte data-Zeile → generischer UPSTREAM_ERROR-Fallback statt Rohtext', () => {
    const { text, error } = extractCoachStreamError('Hallo\nevent: error\ndata: {"kaputt"\n')
    expect(text).toBe('Hallo')
    expect(error?.code).toBe('UPSTREAM_ERROR')
    expect(ApiErrorSchema.safeParse(error).success).toBe(true)
  })

  it('der alte "[Fehler: …]"-Text ist KEIN gültiges Fehlersignal mehr', () => {
    const { text, error } = extractCoachStreamError('Beratung…\n[Fehler: TypeError: fetch failed]')
    expect(error).toBeNull() // Client darf so etwas nicht mehr als Fehler interpretieren müssen
    expect(text).toContain('[Fehler:')
  })
})
