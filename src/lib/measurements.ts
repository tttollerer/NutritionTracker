import type { Measurement, Settings } from '@/db/types'

/**
 * Verlaufswerte-Modul: Katalog der Messgrößen + Fälligkeits-/Trend-Engine.
 * Gruppen sind opt-in wie Allergien (Labor/Vitalwerte/Insulin), Körperwerte sind
 * immer aktiv. Die Engine ist rein (testbar), die UI rendert nur ihre Ausgaben.
 */

export type MetricGroup = 'body' | 'labs' | 'vitals' | 'diabetes'

export interface MetricDef {
  key: string
  group: MetricGroup
  unit: string
  /** Empfohlener Erfassungs-Rhythmus in Tagen. 0 = kein Fälligkeits-Reminder (ad hoc). */
  intervalDays: number
  min: number
  max: number
  decimals: number
}

export const METRICS: MetricDef[] = [
  // Körperwerte — immer aktiv
  { key: 'weight', group: 'body', unit: 'kg', intervalDays: 7, min: 30, max: 400, decimals: 1 },
  { key: 'bodyFat', group: 'body', unit: '%', intervalDays: 14, min: 3, max: 70, decimals: 1 },
  { key: 'waist', group: 'body', unit: 'cm', intervalDays: 14, min: 40, max: 200, decimals: 0 },
  { key: 'hip', group: 'body', unit: 'cm', intervalDays: 14, min: 40, max: 200, decimals: 0 },
  { key: 'arm', group: 'body', unit: 'cm', intervalDays: 14, min: 15, max: 80, decimals: 0 },
  // Laborwerte — opt-in (settings.labValues), langer Rhythmus
  { key: 'ferritin', group: 'labs', unit: 'µg/l', intervalDays: 180, min: 1, max: 2000, decimals: 0 },
  { key: 'vitaminD', group: 'labs', unit: 'ng/ml', intervalDays: 180, min: 1, max: 150, decimals: 0 },
  { key: 'b12', group: 'labs', unit: 'pg/ml', intervalDays: 180, min: 50, max: 2000, decimals: 0 },
  { key: 'hba1c', group: 'labs', unit: '%', intervalDays: 90, min: 3, max: 18, decimals: 1 },
  { key: 'ldl', group: 'labs', unit: 'mg/dl', intervalDays: 180, min: 20, max: 400, decimals: 0 },
  { key: 'hdl', group: 'labs', unit: 'mg/dl', intervalDays: 180, min: 10, max: 150, decimals: 0 },
  { key: 'triglycerides', group: 'labs', unit: 'mg/dl', intervalDays: 180, min: 20, max: 1000, decimals: 0 },
  // Vitalwerte — opt-in (settings.vitals)
  { key: 'systolic', group: 'vitals', unit: 'mmHg', intervalDays: 7, min: 70, max: 260, decimals: 0 },
  { key: 'diastolic', group: 'vitals', unit: 'mmHg', intervalDays: 7, min: 40, max: 160, decimals: 0 },
  { key: 'restingPulse', group: 'vitals', unit: 'bpm', intervalDays: 30, min: 30, max: 200, decimals: 0 },
  // Insulin — an das Diabetes-Modul gekoppelt (settings.bloodSugar), ad hoc
  { key: 'insulin', group: 'diabetes', unit: 'IE', intervalDays: 0, min: 0, max: 200, decimals: 1 },
]

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.key, m]))

export const GROUP_ORDER: MetricGroup[] = ['body', 'labs', 'vitals', 'diabetes']

/** Ist eine Gruppe (und damit ihre Metriken) für den Nutzer aktiv? */
export function groupEnabled(group: MetricGroup, settings: Pick<Settings, 'labValues' | 'vitals' | 'bloodSugar'>): boolean {
  switch (group) {
    case 'body':
      return true
    case 'labs':
      return !!settings.labValues
    case 'vitals':
      return !!settings.vitals
    case 'diabetes':
      return !!settings.bloodSugar
  }
}

/** Alle aktuell aktiven Metriken (nach Gruppen-Gating). */
export function enabledMetrics(settings: Pick<Settings, 'labValues' | 'vitals' | 'bloodSugar'>): MetricDef[] {
  return METRICS.filter((m) => groupEnabled(m.group, settings))
}

/** Ganztägige Differenz zwischen zwei 'YYYY-MM-DD'-Schlüsseln (b - a) in Tagen. */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = new Date(`${fromKey}T00:00:00`).getTime()
  const b = new Date(`${toKey}T00:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/**
 * Welche aktiven Metriken sind heute „fällig"? (intervalDays>0 und entweder nie
 * erfasst oder letzte Erfassung liegt mindestens intervalDays zurück.)
 */
export function dueMetrics(
  settings: Pick<Settings, 'labValues' | 'vitals' | 'bloodSugar'>,
  lastDateByType: Record<string, string | undefined>,
  today: string,
): MetricDef[] {
  return enabledMetrics(settings).filter((m) => {
    if (m.intervalDays <= 0) return false
    const last = lastDateByType[m.key]
    return !last || daysBetween(last, today) >= m.intervalDays
  })
}

/**
 * Trend einer Messreihe über die letzten `windowDays` Tage.
 * @returns latest, delta (latest − ältester im Fenster) und ratePerWeek (kg/Woche o. ä.).
 */
export function trend(
  measurements: Measurement[],
  today: string,
  windowDays = 28,
): { latest: number; delta: number; ratePerWeek: number } | null {
  const within = measurements
    .filter((m) => !m.deletedAt && daysBetween(m.date, today) <= windowDays && daysBetween(m.date, today) >= 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.loggedAt - b.loggedAt))
  if (within.length === 0) return null
  const first = within[0]
  const last = within[within.length - 1]
  const latest = last.value
  if (within.length === 1) return { latest, delta: 0, ratePerWeek: 0 }
  const days = Math.max(1, daysBetween(first.date, last.date))
  const delta = last.value - first.value
  return { latest, delta, ratePerWeek: (delta / days) * 7 }
}

/** Letzten gültigen Wert einer Reihe (für „aktuelles Gewicht" etc.). */
export function latestValue(measurements: Measurement[]): Measurement | null {
  const valid = measurements.filter((m) => !m.deletedAt)
  if (valid.length === 0) return null
  return valid.reduce((a, b) => (a.date > b.date || (a.date === b.date && a.loggedAt >= b.loggedAt) ? a : b))
}

/** Wert in einen Eingaberahmen klemmen (Schutz vor Tippfehlern). */
export function clampValue(def: MetricDef, value: number): number {
  return Math.min(def.max, Math.max(def.min, value))
}
