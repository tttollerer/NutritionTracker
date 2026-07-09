import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiErrorFromResponse, apiErrorKey, isOffline, toApiError } from './apiError'
import { API_ERROR_CODES } from './apiContract'

afterEach(() => vi.restoreAllMocks())

describe('apiErrorKey', () => {
  it('mappt jeden Vertrags-Code auf einen errors.*-Key', () => {
    expect(apiErrorKey('RATE_LIMITED')).toBe('errors.rateLimited')
    expect(apiErrorKey('PAYLOAD_TOO_LARGE')).toBe('errors.payloadTooLarge')
    expect(apiErrorKey('BUDGET_EXCEEDED')).toBe('errors.budgetExceeded')
    expect(apiErrorKey('INVALID_REQUEST')).toBe('errors.invalidRequest')
    expect(apiErrorKey('UPSTREAM_ERROR')).toBe('errors.upstream')
    // Server- und Client-Timeout teilen sich denselben Nutzertext.
    expect(apiErrorKey('UPSTREAM_TIMEOUT')).toBe('errors.timeout')
    expect(apiErrorKey('TIMEOUT')).toBe('errors.timeout')
    expect(apiErrorKey('OFFLINE')).toBe('errors.offline')
    expect(apiErrorKey('GENERIC')).toBe('errors.generic')
  })

  it('kennt alle Codes aus dem Vertrag (kein Code fällt auf generic zurück)', () => {
    for (const code of API_ERROR_CODES) {
      expect(apiErrorKey(code)).toMatch(/^errors\./)
      expect(apiErrorKey(code)).not.toBe('errors.generic')
    }
  })
})

describe('apiErrorFromResponse', () => {
  const resWith = (body: unknown) => ({ json: () => Promise.resolve(body) })

  it('parst den Fehler-Envelope { error, code } und mappt über code', async () => {
    const err = await apiErrorFromResponse(resWith({ error: 'Zu viele Anfragen.', code: 'RATE_LIMITED' }))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.i18nKey).toBe('errors.rateLimited')
    expect(err.message).toBe('Zu viele Anfragen.')
  })

  it('kaputte Antwort ohne JSON (502-HTML-Seite) → GENERIC statt Parse-Crash', async () => {
    const err = await apiErrorFromResponse({ json: () => Promise.reject(new SyntaxError('Unexpected token <')) })
    expect(err.code).toBe('GENERIC')
    expect(err.i18nKey).toBe('errors.generic')
  })

  it('JSON ohne gültigen Envelope (unbekannter code) → GENERIC', async () => {
    const err = await apiErrorFromResponse(resWith({ error: 'x', code: 'WAT' }))
    expect(err.code).toBe('GENERIC')
  })

  it('altes v1.0-Format { error } ohne code → GENERIC (nie über Status/Text mappen)', async () => {
    const err = await apiErrorFromResponse(resWith({ error: 'OpenRouter 502: kaputt' }))
    expect(err.code).toBe('GENERIC')
  })
})

describe('toApiError / Offline-Erkennung', () => {
  it('TypeError (fetch-Netzwerkfehler) → OFFLINE', () => {
    const err = toApiError(new TypeError('Failed to fetch'))
    expect(err.code).toBe('OFFLINE')
    expect(err.i18nKey).toBe('errors.offline')
    expect(err.offline).toBe(true)
  })

  it('navigator.onLine === false → OFFLINE, auch bei anderem Fehler', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(isOffline()).toBe(true)
    expect(toApiError(new Error('irgendwas')).code).toBe('OFFLINE')
  })

  it('AbortSignal.timeout-Abbruch (TimeoutError/AbortError) → TIMEOUT', () => {
    expect(toApiError(new DOMException('t', 'TimeoutError')).i18nKey).toBe('errors.timeout')
    expect(toApiError(new DOMException('a', 'AbortError')).i18nKey).toBe('errors.timeout')
  })

  it('reicht einen vorhandenen ApiError unverändert durch (inkl. partialReply)', () => {
    const orig = new ApiError('UPSTREAM_ERROR', 'kaputt', 'Teilantwort …')
    const err = toApiError(orig)
    expect(err).toBe(orig)
    expect(err.partialReply).toBe('Teilantwort …')
  })

  it('unbekannte Fehler → GENERIC', () => {
    expect(toApiError(new Error('boom')).i18nKey).toBe('errors.generic')
    expect(toApiError('nur ein String').i18nKey).toBe('errors.generic')
  })
})
