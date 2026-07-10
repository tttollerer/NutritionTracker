import { describe, it, expect } from 'vitest'
import { AnalyzeResultSchema, ApiErrorSchema, ReceiptResultSchema } from '../../../src/lib/apiContract'
import {
  ANALYZE_ERROR_TEXT,
  analyzeErrorResponse,
  clampQuestions,
  clampReceipt,
  extractJson,
  MAX_QUESTIONS,
  MAX_RECEIPT_QUANTITY,
  parseAnalyzeRequest,
} from './analyzeShared'

describe('analyzeShared (Helfer der Analyze-Function, Vertrag §1/§2)', () => {
  describe('extractJson', () => {
    it('parst reines JSON', () => {
      expect(extractJson('{"items":[]}')).toEqual({ items: [] })
    })

    it('toleriert ```json-Zäune', () => {
      expect(extractJson('```json\n{"items":[]}\n```')).toEqual({ items: [] })
    })

    it('zieht das Objekt aus umgebendem Text', () => {
      expect(extractJson('Hier dein Ergebnis: {"items":[]} Viel Spaß!')).toEqual({ items: [] })
    })

    it('wirft bei dauerhaft kaputtem Inhalt', () => {
      expect(() => extractJson('kein json weit und breit')).toThrow()
    })
  })

  describe('parseAnalyzeRequest', () => {
    it('akzeptiert einen gültigen Request', () => {
      const parsed = parseAnalyzeRequest(JSON.stringify({ mode: 'meal', imageBase64: 'QUJD' }))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.data.mode).toBe('meal')
    })

    it('lehnt unbekannte Modi und kaputtes JSON ab (INVALID_REQUEST)', () => {
      const bad = parseAnalyzeRequest(JSON.stringify({ mode: 'video', imageBase64: 'QUJD' }))
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.error.code).toBe('INVALID_REQUEST')
      expect(parseAnalyzeRequest('{ kaputt').ok).toBe(false)
    })
  })

  describe('analyzeErrorResponse', () => {
    it('kanonischer Status + Envelope, deutscher Fallback-Text', async () => {
      const res = analyzeErrorResponse('UPSTREAM_TIMEOUT')
      expect(res.status).toBe(504)
      const body = ApiErrorSchema.parse(await res.json())
      expect(body.code).toBe('UPSTREAM_TIMEOUT')
      expect(body.error).toBe(ANALYZE_ERROR_TEXT.UPSTREAM_TIMEOUT)
    })

    it('Status-Override für 405/500-Sonderfälle', () => {
      expect(analyzeErrorResponse('INVALID_REQUEST', 405).status).toBe(405)
      expect(analyzeErrorResponse('UPSTREAM_ERROR', 500).status).toBe(500)
    })

    it('kein Fallback-Text verrät ENV-Namen oder Interna', () => {
      for (const text of Object.values(ANALYZE_ERROR_TEXT)) {
        expect(text).not.toMatch(/OPENROUTER|API_KEY|ENV|stack/i)
      }
    })
  })

  describe('clampQuestions (questions-Sanitizing v1.2, Paket B)', () => {
    const item = {
      name: 'Pommes',
      amount: 150,
      unit: 'g',
      per100: { kcal: 290, protein: 3.5, carbs: 40, fat: 13 },
    }

    it('lässt Antworten ohne questions unverändert durch', () => {
      const raw = { items: [item], notes: 'ok' }
      expect(clampQuestions(raw)).toBe(raw)
      expect(clampQuestions(null)).toBe(null)
      expect(clampQuestions('kein objekt')).toBe('kein objekt')
    })

    it('kappt ein übermotiviertes Modell auf MAX_QUESTIONS und entfernt Leere/Fremdtypen', () => {
      const raw = {
        items: [item],
        questions: ['  Joghurtsauce oder Mayo?  ', '', 42, 'Frittiert?', 'Noch eine dritte?'],
      }
      const clamped = clampQuestions(raw) as { questions?: string[] }
      expect(clamped.questions).toEqual(['Joghurtsauce oder Mayo?', 'Frittiert?'])
      expect(clamped.questions!.length).toBeLessThanOrEqual(MAX_QUESTIONS)
      // Das Ergebnis besteht die Vertragsvalidierung — genau dafür ist das Kappen da.
      expect(AnalyzeResultSchema.safeParse(clamped).success).toBe(true)
    })

    it('entfernt ein leeres/unbrauchbares questions-Feld komplett (abwärtskompatibel)', () => {
      expect(clampQuestions({ items: [item], questions: [] })).toEqual({ items: [item] })
      expect(clampQuestions({ items: [item], questions: 'Mayo?' })).toEqual({ items: [item] })
      expect(clampQuestions({ items: [item], questions: [null, ''] })).toEqual({ items: [item] })
    })

    it('kürzt überlange Fragen auf die Vertragslänge (200 Zeichen)', () => {
      const long = 'F'.repeat(500) + '?'
      const clamped = clampQuestions({ items: [item], questions: [long] }) as { questions: string[] }
      expect(clamped.questions[0]).toHaveLength(200)
      expect(AnalyzeResultSchema.safeParse(clamped).success).toBe(true)
    })
  })

  describe('clampReceipt (Kassenbon-Sanitizing v1.3)', () => {
    it('normalisiert krumme Stückzahlen, rundet Preise auf Cent und trimmt Namen', () => {
      const raw = {
        items: [
          { name: '  H-Milch 3,5 %  ', quantity: 2.0, price: 2.379999 },
          { name: 'Bananen', quantity: '3', price: 'unlesbar' }, // kaputte Typen → Defaults
        ],
      }
      const clamped = clampReceipt(raw)
      expect(clamped).toEqual({
        items: [
          { name: 'H-Milch 3,5 %', quantity: 2, price: 2.38 },
          { name: 'Bananen', quantity: 1 },
        ],
      })
      // Das Ergebnis besteht die Vertragsvalidierung — genau dafür ist das Kappen da.
      expect(ReceiptResultSchema.safeParse(clamped).success).toBe(true)
    })

    it('klemmt die Stückzahl auf 1..MAX_RECEIPT_QUANTITY und verwirft negative Preise', () => {
      const clamped = clampReceipt({
        items: [
          { name: 'Joghurt', quantity: -4, price: -0.25 },
          { name: 'Kaugummi', quantity: 4012345, price: 1.29 },
        ],
      }) as { items: { quantity: number; price?: number }[] }
      expect(clamped.items[0]).toEqual({ name: 'Joghurt', quantity: 1 })
      expect(clamped.items[1].quantity).toBe(MAX_RECEIPT_QUANTITY)
    })

    it('übernimmt per100 nur vollständig (alle vier Makros ≥ 0), sonst gar nicht', () => {
      const clamped = clampReceipt({
        items: [
          { name: 'Milch', quantity: 1, per100: { kcal: 64, protein: 3.4, carbs: 4.8, fat: 3.5 } },
          { name: 'Brot', quantity: 1, per100: { kcal: 250 } }, // halb gefüllt → weg
          { name: 'Käse', quantity: 1, per100: { kcal: -1, protein: 25, carbs: 0, fat: 28 } }, // negativ → weg
        ],
      }) as { items: { per100?: unknown }[] }
      expect(clamped.items[0].per100).toEqual({ kcal: 64, protein: 3.4, carbs: 4.8, fat: 3.5 })
      expect(clamped.items[1].per100).toBeUndefined()
      expect(clamped.items[2].per100).toBeUndefined()
      expect(ReceiptResultSchema.safeParse(clamped).success).toBe(true)
    })

    it('wirft Positionen ohne brauchbaren Namen raus, statt die Antwort zu kippen', () => {
      const clamped = clampReceipt({
        items: [{ name: '   ' }, null, 'PFAND 0,25', { name: 'Äpfel', quantity: 1 }],
      })
      expect(clamped).toEqual({ items: [{ name: 'Äpfel', quantity: 1 }] })
    })

    it('lässt Antworten ohne items-Array unverändert (zod → Retry/Envelope)', () => {
      const noItems = { notes: 'nur Text' }
      expect(clampReceipt(noItems)).toBe(noItems)
      expect(clampReceipt(null)).toBe(null)
      expect(clampReceipt('kein objekt')).toBe('kein objekt')
    })
  })
})
