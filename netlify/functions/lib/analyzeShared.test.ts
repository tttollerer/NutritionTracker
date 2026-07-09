import { describe, it, expect } from 'vitest'
import { ApiErrorSchema } from '../../../src/lib/apiContract'
import {
  ANALYZE_ERROR_TEXT,
  analyzeErrorResponse,
  extractJson,
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
})
