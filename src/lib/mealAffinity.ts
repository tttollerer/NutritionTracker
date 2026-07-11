import type { FoodItem, LogEntry, Meal } from '@/db/types'
import { todayKey } from '@/lib/utils'

/**
 * Tageszeit-Affinität (Speed-Paket 2b): Foods danach ordnen, wie oft sie in
 * den letzten 14 Tagen zur gewählten Mahlzeit geloggt wurden — morgens stehen
 * so die Frühstücks-Produkte vorn. Pure Funktionen über bereits geladene Logs
 * (testbar ohne DB, Muster src/lib/budget.ts); nur das Zeitfenster liefert
 * affinityStartKey für die DB-Abfrage des Aufrufers.
 */

/** Betrachtetes Zeitfenster in Tagen (inklusive heute). */
export const AFFINITY_DAYS = 14

/** Erster Tag ('YYYY-MM-DD') des Fensters — lokal & DST-sicher über setDate. */
export function affinityStartKey(today = todayKey()): string {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - (AFFINITY_DAYS - 1))
  return todayKey(dt)
}

/**
 * Log-Häufigkeit je foodId für EINE Mahlzeit. Gelöschte und geplante Logs
 * (planned = Wochenplan, nie gegessen) zählen nicht; die Logs müssen bereits
 * aufs Zeitfenster begrenzt sein (affinityStartKey → heute).
 */
export function mealAffinityCounts(
  logs: Pick<LogEntry, 'foodId' | 'meal' | 'planned' | 'deletedAt'>[],
  meal: Meal,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const l of logs) {
    if (l.deletedAt || l.planned || l.meal !== meal) continue
    counts.set(l.foodId, (counts.get(l.foodId) ?? 0) + 1)
  }
  return counts
}

/**
 * Foods nach Affinität sortieren: häufig zur Mahlzeit geloggte zuerst
 * (absteigend), bei Gleichstand zuletzt benutzte (updatedAt). Ohne Treffer
 * bleibt so schlicht die gewohnte „zuletzt benutzt"-Reihenfolge. Gibt eine
 * neue Liste zurück — die Eingabe bleibt unverändert.
 */
export function sortByMealAffinity<T extends Pick<FoodItem, 'id' | 'updatedAt'>>(
  foods: T[],
  counts: Map<string, number>,
): T[] {
  return [...foods].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || b.updatedAt - a.updatedAt,
  )
}
