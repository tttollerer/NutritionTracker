import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiErrorSchema } from '../../../src/lib/apiContract'
import {
  DEFAULT_DAILY_BUDGET,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  allowedOrigins,
  clientIp,
  createDailyBudget,
  createGuard,
  createRateLimiter,
  dailyBudgetLimit,
  guardResponse,
  originAllowed,
} from './guard'

/** POST-Request mit optionalen Headern bauen. */
function post(headers: Record<string, string> = {}, body = '{}'): Request {
  return new Request('http://localhost/api/analyze', { method: 'POST', headers, body })
}

describe('guard.ts — gemeinsame Schutzschicht (Paket 3)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('Origin-/Referer-Check (ALLOWED_ORIGIN)', () => {
    it('ohne ALLOWED_ORIGIN wird der Check übersprungen (lokale Previews)', () => {
      vi.stubEnv('ALLOWED_ORIGIN', '')
      expect(allowedOrigins()).toBeNull()
      expect(originAllowed(post())).toBe(true)
      expect(originAllowed(post({ origin: 'https://evil.example' }))).toBe(true)
    })

    it('erlaubte Origin passiert, fremde nicht', () => {
      vi.stubEnv('ALLOWED_ORIGIN', 'https://nutriscan.netlify.app')
      expect(originAllowed(post({ origin: 'https://nutriscan.netlify.app' }))).toBe(true)
      expect(originAllowed(post({ origin: 'https://evil.example' }))).toBe(false)
    })

    it('kommaseparierte Liste + Schrägstrich-Toleranz', () => {
      vi.stubEnv('ALLOWED_ORIGIN', 'https://a.example/, https://b.example')
      expect(originAllowed(post({ origin: 'https://a.example' }))).toBe(true)
      expect(originAllowed(post({ origin: 'https://b.example' }))).toBe(true)
      expect(originAllowed(post({ origin: 'https://c.example' }))).toBe(false)
    })

    it('Referer-Fallback: volle Seiten-URL wird auf die Origin reduziert', () => {
      vi.stubEnv('ALLOWED_ORIGIN', 'https://nutriscan.netlify.app')
      expect(originAllowed(post({ referer: 'https://nutriscan.netlify.app/scan?x=1' }))).toBe(true)
      expect(originAllowed(post({ referer: 'https://evil.example/scan' }))).toBe(false)
    })

    it('ohne Origin/Referer wird bei aktivem Check abgelehnt (curl-Dauerfeuer)', () => {
      vi.stubEnv('ALLOWED_ORIGIN', 'https://nutriscan.netlify.app')
      expect(originAllowed(post())).toBe(false)
    })
  })

  describe('clientIp', () => {
    it('bevorzugt Netlify-Header, dann x-forwarded-for, sonst unknown', () => {
      expect(clientIp(post({ 'x-nf-client-connection-ip': '1.2.3.4' }))).toBe('1.2.3.4')
      expect(clientIp(post({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe('5.6.7.8')
      expect(clientIp(post())).toBe('unknown')
    })
  })

  describe('Rate-Limit (Festfenster pro IP, in-memory)', () => {
    it('erlaubt genau MAX Requests pro Fenster, dann Schluss', () => {
      const limiter = createRateLimiter()
      const t0 = 1_000_000
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        expect(limiter.allow('ip-a', t0 + i)).toBe(true)
      }
      expect(limiter.allow('ip-a', t0 + RATE_LIMIT_MAX_REQUESTS)).toBe(false)
      // Andere IP hat ihr eigenes Fenster.
      expect(limiter.allow('ip-b', t0)).toBe(true)
    })

    it('nach Ablauf des Fensters wird wieder erlaubt', () => {
      const limiter = createRateLimiter(2, 1000)
      expect(limiter.allow('ip', 0)).toBe(true)
      expect(limiter.allow('ip', 1)).toBe(true)
      expect(limiter.allow('ip', 2)).toBe(false)
      expect(limiter.allow('ip', 1001)).toBe(true)
    })
  })

  describe('Tagesbudget (in-memory, UTC-Tag)', () => {
    it('Default aus DEFAULT_DAILY_BUDGET, überschreibbar per DAILY_BUDGET', () => {
      expect(dailyBudgetLimit()).toBe(DEFAULT_DAILY_BUDGET)
      vi.stubEnv('DAILY_BUDGET', '5')
      expect(dailyBudgetLimit()).toBe(5)
      vi.stubEnv('DAILY_BUDGET', 'quatsch')
      expect(dailyBudgetLimit()).toBe(DEFAULT_DAILY_BUDGET)
    })

    it('verbraucht bis zum Limit, blockt danach, reset am Folgetag', () => {
      const budget = createDailyBudget(() => 2)
      const day1 = Date.UTC(2026, 6, 5, 10)
      expect(budget.consume(day1)).toBe(true)
      expect(budget.consume(day1)).toBe(true)
      expect(budget.consume(day1)).toBe(false)
      const day2 = Date.UTC(2026, 6, 6, 0, 1)
      expect(budget.consume(day2)).toBe(true)
    })
  })

  describe('guardResponse — Envelope + kanonischer Status', () => {
    it('nutzt API_ERROR_STATUS und den generischen deutschen Text', async () => {
      const res = guardResponse('RATE_LIMITED')
      expect(res.status).toBe(429)
      const body = ApiErrorSchema.parse(await res.json())
      expect(body.code).toBe('RATE_LIMITED')
    })

    it('Status-Override für Sonderfälle (Origin-403)', () => {
      expect(guardResponse('INVALID_REQUEST', 403).status).toBe(403)
    })
  })

  describe('createGuard — Komposit', () => {
    it('before: Origin-Mismatch → 403 INVALID_REQUEST', async () => {
      vi.stubEnv('ALLOWED_ORIGIN', 'https://nutriscan.netlify.app')
      const guard = createGuard({ name: 'test', maxBodyBytes: 1024 })
      const res = guard.before(post({ origin: 'https://evil.example' }))
      expect(res?.status).toBe(403)
      expect(ApiErrorSchema.parse(await res!.json()).code).toBe('INVALID_REQUEST')
    })

    it('before: Content-Length über Limit → 413 VOR dem Einlesen', async () => {
      const guard = createGuard({ name: 'test', maxBodyBytes: 10 })
      // Header explizit setzen: konstruierte Requests tragen (anders als echte
      // eingehende) keinen automatischen Content-Length-Header.
      const req = post({ 'content-length': '64' }, 'x'.repeat(64))
      const res = guard.before(req)
      expect(res?.status).toBe(413)
      expect(ApiErrorSchema.parse(await res!.json()).code).toBe('PAYLOAD_TOO_LARGE')
      expect(req.bodyUsed).toBe(false)
    })

    it('before: nach MAX Requests derselben IP → 429 RATE_LIMITED', async () => {
      let t = 0
      const guard = createGuard({ name: 'test', maxBodyBytes: 1024, now: () => t })
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        expect(guard.before(post())).toBeNull()
      }
      const res = guard.before(post())
      expect(res?.status).toBe(429)
      expect(ApiErrorSchema.parse(await res!.json()).code).toBe('RATE_LIMITED')
      // Nächstes Fenster: wieder frei.
      t = RATE_LIMIT_WINDOW_MS
      expect(guard.before(post())).toBeNull()
    })

    it('bodyCheck: Stringlänge über Limit → 413 (Content-Length kann lügen)', async () => {
      const guard = createGuard({ name: 'test', maxBodyBytes: 10 })
      expect(guard.bodyCheck('kurz')).toBeNull()
      const res = guard.bodyCheck('x'.repeat(11))
      expect(res?.status).toBe(413)
      expect(ApiErrorSchema.parse(await res!.json()).code).toBe('PAYLOAD_TOO_LARGE')
    })

    it('consumeBudget: nach DAILY_BUDGET Aufrufen → 402 BUDGET_EXCEEDED', async () => {
      vi.stubEnv('DAILY_BUDGET', '2')
      const guard = createGuard({ name: 'test', maxBodyBytes: 1024 })
      expect(guard.consumeBudget()).toBeNull()
      expect(guard.consumeBudget()).toBeNull()
      const res = guard.consumeBudget()
      expect(res?.status).toBe(402)
      expect(ApiErrorSchema.parse(await res!.json()).code).toBe('BUDGET_EXCEEDED')
    })
  })
})
