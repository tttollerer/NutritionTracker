import { API_ERROR_STATUS, apiError, type ApiErrorCode } from '../../../src/lib/apiContract'

/**
 * Gemeinsame Schutzschicht der öffentlichen Functions (analyze.mts, coach.mts)
 * — PLAN.md §3 „Schutz des Endpunkts", API_CONTRACT.md §1, ABSCHLUSSPLAN
 * Paket 3. Vier Schichten, alle VOR dem Upstream-Call:
 *
 *   1. Origin-/Referer-Check gegen ALLOWED_ORIGIN     → 403 INVALID_REQUEST
 *   2. Body-Größenlimit (Content-Length + Stringlänge) → 413 PAYLOAD_TOO_LARGE
 *   3. Rate-Limit pro IP (Festfenster)                 → 429 RATE_LIMITED
 *   4. Hartes Tagesbudget für Upstream-Calls           → 402 BUDGET_EXCEEDED
 *
 * EHRLICHE LIMITATION (bewusst, PLAN.md §3 „einfach reicht"): Rate-Limit und
 * Tagesbudget leben IN-MEMORY im Modul-Scope — d. h. pro Lambda-/Function-
 * Instanz, ohne verteilten Store (kein Redis o. Ä.). Bei mehreren parallelen
 * Instanzen zählt jede für sich (effektives Limit = Limit × Instanzen), und
 * ein Cold Start setzt die Zähler zurück. Für dieses Projekt (Schutz gegen
 * Dauerfeuer/Kosten-Amok, nicht gegen gezielte verteilte Angriffe) ist das
 * ausreichend; die harte Kostenbremse bleibt das OpenRouter-Guthaben.
 *
 * ENV (optional): ALLOWED_ORIGIN (kommaseparierte Origins; fehlt sie, wird der
 * Origin-Check übersprungen, damit lokale Previews/netlify dev nicht brechen),
 * DAILY_BUDGET (Upstream-Calls/Tag, Default 300). Keine Secrets in dieser
 * Datei; ENV-Namen erscheinen nie in Client-Antworten (Vertrag §1).
 */

// ---------------------------------------------------------------------------
// Grenzen (Konstanten, Paket 3)
// ---------------------------------------------------------------------------

/** Max. Requests pro IP und Zeitfenster. */
export const RATE_LIMIT_MAX_REQUESTS = 20
/** Länge des Rate-Limit-Fensters. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60_000 // 10 min
/** Default-Tagesbudget an Upstream-Calls, wenn DAILY_BUDGET nicht gesetzt ist. */
export const DEFAULT_DAILY_BUDGET = 300
/** Obergrenze verwalteter IP-Einträge (Schutz vor unbegrenztem Map-Wachstum). */
const RATE_LIMIT_MAX_TRACKED_IPS = 5000

// ---------------------------------------------------------------------------
// Fehler-Envelope (generische Texte — funktionsneutral formuliert)
// ---------------------------------------------------------------------------

/** Deutsche Fallback-Texte der Guard-Codes; NIE interne Details (Vertrag §1). */
export const GUARD_ERROR_TEXT: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: 'Ungültige Anfrage.',
  BUDGET_EXCEEDED: 'Das Tageskontingent für KI-Anfragen ist aufgebraucht. Bitte versuch es morgen wieder.',
  PAYLOAD_TOO_LARGE: 'Die Anfrage ist zu groß. Bitte verkleinere das Foto.',
  RATE_LIMITED: 'Zu viele Anfragen. Bitte warte einen Moment und versuch es erneut.',
  UPSTREAM_ERROR: 'Der Dienst ist gerade nicht erreichbar. Bitte versuch es später erneut.',
  UPSTREAM_TIMEOUT: 'Der Dienst hat zu lange nicht geantwortet. Bitte versuch es später erneut.',
}

/**
 * Envelope-Antwort mit optional abweichendem Text/Status (Status-Override für
 * die Vertrags-Sonderfälle 405/500 und den Origin-403, siehe §1 Fußnoten).
 */
export function guardResponse(code: ApiErrorCode, status?: number, text?: string): Response {
  return new Response(JSON.stringify(apiError(code, text ?? GUARD_ERROR_TEXT[code])), {
    status: status ?? API_ERROR_STATUS[code],
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// 1) Origin-/Referer-Check (ALLOWED_ORIGIN)
// ---------------------------------------------------------------------------

/** ALLOWED_ORIGIN parsen; null = ENV fehlt/leer → Check überspringen. */
export function allowedOrigins(): string[] | null {
  const raw = process.env.ALLOWED_ORIGIN?.trim()
  if (!raw) return null
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return list.length > 0 ? list : null
}

/** Origin einer URL/eines Origin-Strings normalisieren (null bei Müll). */
function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * true = Request darf passieren. Ohne konfiguriertes ALLOWED_ORIGIN wird
 * immer erlaubt (lokale Previews). Mit Konfiguration muss Origin- ODER
 * Referer-Header auf eine erlaubte Origin zeigen — Browser senden bei
 * POST-`fetch`es immer `Origin` mit; Requests ganz ohne beide Header
 * (curl-Dauerfeuer) werden dann abgelehnt. Kein harter Auth-Ersatz
 * (Header sind fälschbar), aber eine wirksame Hürde gegen fremde Websites
 * und triviale Scripts (PLAN.md §3).
 */
export function originAllowed(req: Request): boolean {
  const allowed = allowedOrigins()
  if (!allowed) return true
  const candidate = req.headers.get('origin') ?? req.headers.get('referer')
  if (!candidate) return false
  const origin = normalizeOrigin(candidate)
  if (!origin) return false
  return allowed.some((a) => normalizeOrigin(a) === origin)
}

// ---------------------------------------------------------------------------
// 2) Client-IP + Rate-Limit (Festfenster, in-memory — Limitation s. o.)
// ---------------------------------------------------------------------------

/** Client-IP aus Netlify-Headern; 'unknown' als gemeinsamer Fallback-Topf. */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

export interface RateLimiter {
  /** true = Request zählt und darf passieren; false = Limit erreicht. */
  allow(ip: string, now?: number): boolean
}

/**
 * Festfenster-Zähler pro IP: max. `max` Requests je `windowMs`. Bewusst
 * simpel (kein Sliding Window) — Genauigkeit an der Fenstergrenze ist für
 * den Zweck egal. `now` ist für Tests injizierbar.
 */
export function createRateLimiter(
  max = RATE_LIMIT_MAX_REQUESTS,
  windowMs = RATE_LIMIT_WINDOW_MS,
): RateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>()
  return {
    allow(ip: string, now = Date.now()): boolean {
      // Speicher-Deckel: abgelaufene Fenster räumen, bevor die Map wuchert.
      if (buckets.size >= RATE_LIMIT_MAX_TRACKED_IPS) {
        for (const [key, b] of buckets) {
          if (now - b.windowStart >= windowMs) buckets.delete(key)
        }
      }
      const bucket = buckets.get(ip)
      if (!bucket || now - bucket.windowStart >= windowMs) {
        buckets.set(ip, { windowStart: now, count: 1 })
        return true
      }
      bucket.count++
      return bucket.count <= max
    },
  }
}

// ---------------------------------------------------------------------------
// 3) Tagesbudget (in-memory Tageszähler — Limitation s. o.)
// ---------------------------------------------------------------------------

/** DAILY_BUDGET aus ENV (Upstream-Calls/Tag), sonst Default. */
export function dailyBudgetLimit(): number {
  const raw = Number(process.env.DAILY_BUDGET)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_BUDGET
}

export interface DailyBudget {
  /** Einen Upstream-Call verbuchen; false = Budget für heute (UTC) erschöpft. */
  consume(now?: number): boolean
}

export function createDailyBudget(limit: () => number = dailyBudgetLimit): DailyBudget {
  let day = ''
  let used = 0
  return {
    consume(now = Date.now()): boolean {
      const today = new Date(now).toISOString().slice(0, 10) // UTC-Tag
      if (today !== day) {
        day = today
        used = 0
      }
      if (used >= limit()) return false
      used++
      return true
    },
  }
}

// ---------------------------------------------------------------------------
// Komposit-Guard für die Function-Handler
// ---------------------------------------------------------------------------

export interface Guard {
  /**
   * Checks VOR dem Einlesen des Bodys: Origin (403), Content-Length (413),
   * Rate-Limit (429). null = passieren lassen.
   */
  before(req: Request): Response | null
  /**
   * Stringlänge des bereits eingelesenen Bodys prüfen — Content-Length kann
   * fehlen oder lügen (413). VOR jedem JSON.parse aufrufen.
   */
  bodyCheck(raw: string): Response | null
  /** Tagesbudget für den bevorstehenden Upstream-Call verbuchen (402). */
  consumeBudget(): Response | null
}

export interface GuardConfig {
  /** Function-Name fürs Server-Log (z. B. 'analyze'). */
  name: string
  /** Body-Obergrenze in Bytes (analyze 6 MB, coach 256 KB — Vertrag §1). */
  maxBodyBytes: number
  now?: () => number
}

/**
 * Einen Guard pro Function-Modul anlegen (Modul-Scope). Rate-Limit- und
 * Budget-Zähler sind damit pro Function UND pro Instanz getrennt —
 * s. Limitation im Datei-Kopf. Ein Request zählt genau EINE Budget-Einheit,
 * auch wenn die Function intern einen Retry fährt.
 */
export function createGuard(config: GuardConfig): Guard {
  const { name, maxBodyBytes } = config
  const now = config.now ?? Date.now
  const limiter = createRateLimiter()
  const budget = createDailyBudget()
  return {
    before(req: Request): Response | null {
      if (!originAllowed(req)) {
        console.error(`${name}: Origin/Referer nicht erlaubt (ALLOWED_ORIGIN aktiv)`)
        return guardResponse('INVALID_REQUEST', 403)
      }
      const len = Number(req.headers.get('content-length'))
      if (Number.isFinite(len) && len > maxBodyBytes) return guardResponse('PAYLOAD_TOO_LARGE')
      if (!limiter.allow(clientIp(req), now())) return guardResponse('RATE_LIMITED')
      return null
    },
    bodyCheck(raw: string): Response | null {
      return raw.length > maxBodyBytes ? guardResponse('PAYLOAD_TOO_LARGE') : null
    },
    consumeBudget(): Response | null {
      if (budget.consume(now())) return null
      console.error(`${name}: Tagesbudget (${dailyBudgetLimit()}) erschöpft`)
      return guardResponse('BUDGET_EXCEEDED')
    },
  }
}
