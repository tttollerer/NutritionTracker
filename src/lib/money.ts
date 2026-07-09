import type { LogEntry } from '@/db/types'

/**
 * Haushaltskassen-Helfer: zentrale EUR-Formatierung + Summen über die
 * cost-Snapshots der Log-Einträge. Bewusst pure Funktionen (testbar ohne DB).
 */

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/** Betrag als EUR formatieren („2,49 €") — keine String-Bastelei in der UI. */
export function formatEuro(amount: number): string {
  return EUR.format(amount)
}

/** Summe der Kosten-Snapshots (Einträge ohne Preis zählen 0), auf Cent gerundet. */
export function sumCost(logs: Pick<LogEntry, 'cost'>[]): number {
  const sum = logs.reduce((a, l) => a + (l.cost ?? 0), 0)
  return Math.round(sum * 100) / 100
}

/**
 * Kosten je Tag aus Logs (nicht gelöschte, mit cost) — Basis für die
 * Haushaltskassen-Karte: Wochensumme + Ø pro Tag mit Kostendaten.
 */
export function costByDate(logs: Pick<LogEntry, 'cost' | 'date' | 'deletedAt'>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of logs) {
    if (l.deletedAt || l.cost == null) continue
    out[l.date] = Math.round(((out[l.date] ?? 0) + l.cost) * 100) / 100
  }
  return out
}

/**
 * Komma-tolerante Preis-/Zahleneingabe („2,49" → 2.49). NaN/≤0-fähig:
 * Rückgabe undefined, wenn keine positive Zahl erkennbar ist.
 */
export function parsePositiveNumber(text: string): number | undefined {
  const n = Number.parseFloat(text.trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : undefined
}
