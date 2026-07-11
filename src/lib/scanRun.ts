/**
 * Scan-Loop beim Einräumen ohne Kassenbon: zählt, wie viele Produkte in der
 * laufenden Runde in den Vorrat gewandert sind (Capture → Review → „Nur in
 * den Vorrat" → zurück zu Capture). In sessionStorage (Muster reviewStore),
 * damit der Zähler die Capture↔Review-Navigation und einen Reload übersteht.
 */

const KEY = 'nt-scan-run'

function write(count: number): void {
  try {
    sessionStorage.setItem(KEY, String(count))
  } catch {
    // Flüchtiger Arbeitszustand — volle Quota darf den Flow nicht crashen.
  }
}

/** Runde beginnen (Zähler 0). Eine bereits laufende Runde bleibt unangetastet. */
export function startScanRun(): void {
  if (readScanRun() != null) return
  write(0)
}

/** Zähler erhöhen (startet implizit bei 0). Gibt den neuen Stand zurück. */
export function incrementScanRun(by = 1): number {
  const next = (readScanRun() ?? 0) + by
  write(next)
  return next
}

/** Aktueller Stand der Runde — null, wenn keine läuft (oder Wert kaputt ist). */
export function readScanRun(): number | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Runde beenden („Fertig" / Capture verlassen). */
export function clearScanRun(): void {
  sessionStorage.removeItem(KEY)
}
