import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  AnalyzeRequestSchema,
  AnalyzeResultSchema,
  ApiErrorSchema,
  apiError,
  COACH_NUTRIENTS,
  CoachChallengeRuleSchema,
  CoachRequestSchema,
  CoachSuggestionsSchema,
  ReceiptItemSchema,
  ReceiptResultSchema,
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

describe('AnalyzeResultSchema v1.2 — optionales questions-Feld (Paket B)', () => {
  const item = {
    name: 'Pommes',
    amount: 150,
    unit: 'g',
    per100: { kcal: 290, protein: 3.5, carbs: 40, fat: 13 },
  }

  it('parst OHNE questions (abwärtskompatibel, Feld fehlt einfach)', () => {
    const parsed = AnalyzeResultSchema.parse({ items: [item], notes: 'geschätzt' })
    expect(parsed.questions).toBeUndefined()
  })

  it('parst MIT bis zu 2 kurzen Rückfragen', () => {
    const parsed = AnalyzeResultSchema.parse({
      items: [item],
      questions: ['Joghurtsauce oder Mayo?', 'Frittiert oder aus dem Ofen?'],
    })
    expect(parsed.questions).toHaveLength(2)
  })

  it('lehnt mehr als 2 Fragen und leere Strings ab', () => {
    expect(AnalyzeResultSchema.safeParse({ items: [item], questions: ['a?', 'b?', 'c?'] }).success).toBe(false)
    expect(AnalyzeResultSchema.safeParse({ items: [item], questions: [''] }).success).toBe(false)
  })
})

describe('AnalyzeResultSchema v1.4 — optionales barcode-Feld (Foto-Scan)', () => {
  const item = {
    name: 'Bier',
    amount: 500,
    unit: 'ml',
    per100: { kcal: 42, protein: 0.5, carbs: 3, fat: 0 },
  }

  it('parst OHNE barcode (abwärtskompatibel) und MIT gültigem EAN', () => {
    expect(AnalyzeResultSchema.parse({ items: [item] }).barcode).toBeUndefined()
    expect(AnalyzeResultSchema.parse({ items: [item], barcode: '4066600203704' }).barcode).toBe('4066600203704')
  })

  it('lehnt Nicht-Ziffern und unplausible Längen ab (Sanitizing macht der Server)', () => {
    expect(AnalyzeResultSchema.safeParse({ items: [item], barcode: '40666 00203704' }).success).toBe(false)
    expect(AnalyzeResultSchema.safeParse({ items: [item], barcode: '1234567' }).success).toBe(false)
    expect(AnalyzeResultSchema.safeParse({ items: [item], barcode: '123456789012345' }).success).toBe(false)
  })
})

describe('AnalyzeRequestSchema v1.5 — mode estimate (Text-Schätzung ohne Bild)', () => {
  it('estimate braucht KEIN Bild, aber einen Namen im hint', () => {
    expect(AnalyzeRequestSchema.safeParse({ mode: 'estimate', hint: 'Leberkäse Brötchen' }).success).toBe(true)
    expect(AnalyzeRequestSchema.safeParse({ mode: 'estimate' }).success).toBe(false)
    expect(AnalyzeRequestSchema.safeParse({ mode: 'estimate', hint: '   ' }).success).toBe(false)
  })

  it('Bild-Modi verlangen weiterhin zwingend imageBase64', () => {
    for (const mode of ['meal', 'label', 'portion', 'receipt']) {
      expect(AnalyzeRequestSchema.safeParse({ mode, hint: 'x' }).success).toBe(false)
      expect(AnalyzeRequestSchema.safeParse({ mode, imageBase64: 'QUJD' }).success).toBe(true)
    }
  })
})

describe('Kassenbon-Scan v1.3 — mode receipt + ReceiptResultSchema', () => {
  it('AnalyzeRequestSchema akzeptiert den neuen Modus "receipt" (additiv)', () => {
    expect(AnalyzeRequestSchema.safeParse({ mode: 'receipt', imageBase64: 'QUJD' }).success).toBe(true)
    // Bestehende Modi bleiben unverändert gültig.
    for (const mode of ['meal', 'label', 'portion']) {
      expect(AnalyzeRequestSchema.safeParse({ mode, imageBase64: 'QUJD' }).success).toBe(true)
    }
  })

  it('parst eine typische Bon-Position (price und per100 optional)', () => {
    const full = {
      name: 'H-Milch 3,5 %',
      quantity: 2,
      price: 2.38,
      per100: { kcal: 64, protein: 3.4, carbs: 4.8, fat: 3.5 },
    }
    expect(ReceiptItemSchema.parse(full)).toEqual(full)
    // Minimalform: nur Name + Stückzahl.
    expect(ReceiptItemSchema.safeParse({ name: 'Bananen', quantity: 1 }).success).toBe(true)
    expect(ReceiptResultSchema.safeParse({ items: [full, { name: 'Bananen', quantity: 1 }] }).success).toBe(true)
  })

  it('lehnt leeren Namen, krumme/negative Stückzahl und negativen Preis ab', () => {
    expect(ReceiptItemSchema.safeParse({ name: '', quantity: 1 }).success).toBe(false)
    expect(ReceiptItemSchema.safeParse({ name: 'Milch', quantity: 0 }).success).toBe(false)
    expect(ReceiptItemSchema.safeParse({ name: 'Milch', quantity: 1.5 }).success).toBe(false)
    expect(ReceiptItemSchema.safeParse({ name: 'Pfand', quantity: 1, price: -0.25 }).success).toBe(false)
  })

  it('lehnt halb gefülltes per100 ab — entweder alle vier Makros oder gar keins', () => {
    expect(ReceiptItemSchema.safeParse({ name: 'Milch', quantity: 1, per100: { kcal: 64 } }).success).toBe(false)
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

describe('CoachSuggestionsSchema v1.2 — Nutrient-Enum für Ziele (Befund 4)', () => {
  const goal = (nutrient: string) => ({
    goals: [{ nutrient, type: 'max', target: 25, unit: 'g' }],
  })

  it('akzeptiert jeden Enum-Wert als Ziel-Nährstoff', () => {
    for (const n of COACH_NUTRIENTS) {
      expect(CoachSuggestionsSchema.safeParse(goal(n)).success).toBe(true)
    }
  })

  it('lehnt fremde nutrients ab — sie würden beim Nutzer im Nichts landen', () => {
    for (const bad of ['vitaminC', 'iron', 'salt', 'zucker', 'Protein', '']) {
      expect(CoachSuggestionsSchema.safeParse(goal(bad)).success).toBe(false)
    }
  })

  it('"salt" ist bewusst nicht im Enum — der Katalog trackt "sodium"', () => {
    expect(COACH_NUTRIENTS).not.toContain('salt')
    expect(COACH_NUTRIENTS).toContain('sodium')
  })
})

describe('CoachSuggestionsSchema v1.2 — Challenge-rule (Befund 8)', () => {
  const withRule = (rule: unknown, period: 'day' | 'week' = 'week') => ({
    challenges: [{ title: 'Protein-Woche', period, rule }],
  })

  it('akzeptiert eine Challenge mit auto-auswertbarer rule (Wochenformat)', () => {
    const line = withRule({ nutrient: 'protein', type: 'min', target: 120, unit: 'g', days: 5 })
    expect(CoachSuggestionsSchema.safeParse(line).success).toBe(true)
  })

  it('akzeptiert eine Tages-rule ohne days und die v1.1-Form ohne rule (abwärtskompatibel)', () => {
    expect(
      CoachSuggestionsSchema.safeParse(withRule({ nutrient: 'sugar', type: 'max', target: 25 }, 'day')).success,
    ).toBe(true)
    expect(
      CoachSuggestionsSchema.safeParse({ challenges: [{ title: '3x Gemüse', period: 'day' }] }).success,
    ).toBe(true)
  })

  it('lehnt kaputte rules ab: target ≤ 0, fremder nutrient, days außerhalb 1–7, type "range"', () => {
    expect(CoachChallengeRuleSchema.safeParse({ nutrient: 'protein', type: 'min', target: 0 }).success).toBe(false)
    expect(CoachChallengeRuleSchema.safeParse({ nutrient: 'vitaminC', type: 'min', target: 90 }).success).toBe(false)
    expect(CoachChallengeRuleSchema.safeParse({ nutrient: 'kcal', type: 'max', target: 2000, days: 8 }).success).toBe(false)
    expect(CoachChallengeRuleSchema.safeParse({ nutrient: 'kcal', type: 'range', target: 1800 }).success).toBe(false)
  })

  it('lehnt days bei period "day" ab (nur Wochen-Challenges zählen Erfolgstage)', () => {
    const line = withRule({ nutrient: 'protein', type: 'min', target: 30, days: 3 }, 'day')
    expect(CoachSuggestionsSchema.safeParse(line).success).toBe(false)
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
