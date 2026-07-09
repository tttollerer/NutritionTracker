import { ApiErrorSchema, type ApiErrorCode } from './apiContract'

/**
 * Clientseitiges Fehler-Mapping für die API-Aufrufe (Vertrag v1.1,
 * docs/API_CONTRACT.md §1): Der Client mappt IMMER über `code` auf i18n-Texte,
 * nie über HTTP-Status oder Fehlertext. Offline/Timeout sind reine
 * Client-Zustände und ergänzen die Vertrags-Codes.
 */

/** Zusatz-Codes, die nur der Client kennt (kein Serverzustand, vgl. Vertrag §1). */
export type ClientErrorCode = 'OFFLINE' | 'TIMEOUT' | 'GENERIC'
export type AppErrorCode = ApiErrorCode | ClientErrorCode

const I18N_KEYS: Record<AppErrorCode, string> = {
  OFFLINE: 'errors.offline',
  TIMEOUT: 'errors.timeout',
  GENERIC: 'errors.generic',
  INVALID_REQUEST: 'errors.invalidRequest',
  BUDGET_EXCEEDED: 'errors.budgetExceeded',
  PAYLOAD_TOO_LARGE: 'errors.payloadTooLarge',
  RATE_LIMITED: 'errors.rateLimited',
  UPSTREAM_ERROR: 'errors.upstream',
  UPSTREAM_TIMEOUT: 'errors.timeout',
}

/** i18n-Key (de.json `errors.*`) zu einem Fehlercode. */
export function apiErrorKey(code: AppErrorCode): string {
  return I18N_KEYS[code] ?? 'errors.generic'
}

/** Typisierter API-Fehler — UI zeigt `t(err.i18nKey)`, nie `err.message`. */
export class ApiError extends Error {
  readonly code: AppErrorCode
  /** Bei Coach-Stream-Abbruch: bereits empfangener, anzeigbarer Antwortteil. */
  readonly partialReply?: string

  constructor(code: AppErrorCode, message?: string, partialReply?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.partialReply = partialReply
  }

  get i18nKey(): string {
    return apiErrorKey(this.code)
  }

  /** Offline-Fehler bekommen in der UI zusätzlich den Ausweg „manuell erfassen". */
  get offline(): boolean {
    return this.code === 'OFFLINE'
  }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Wandelt einen beliebigen gefangenen Fehler in einen typisierten ApiError:
 * - `navigator.onLine === false` oder `TypeError` (fetch-Netzwerkfehler) → OFFLINE
 * - `AbortError`/`TimeoutError` (AbortSignal.timeout) → TIMEOUT
 * - sonst GENERIC
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (isOffline() || err instanceof TypeError) return new ApiError('OFFLINE')
  if (
    err instanceof DOMException &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  ) {
    return new ApiError('TIMEOUT')
  }
  return new ApiError('GENERIC', err instanceof Error ? err.message : undefined)
}

interface ResponseLike {
  json(): Promise<unknown>
}

/**
 * Liest den Fehler-Envelope `{ error, code }` (ApiErrorSchema) aus einer
 * Nicht-200-Antwort. Kein/kaputtes JSON (z. B. 502-HTML-Seite eines Proxys)
 * → GENERIC statt kryptischem Parse-Fehler.
 */
export async function apiErrorFromResponse(res: ResponseLike): Promise<ApiError> {
  try {
    const env = ApiErrorSchema.parse(await res.json())
    return new ApiError(env.code, env.error)
  } catch {
    return new ApiError('GENERIC')
  }
}
