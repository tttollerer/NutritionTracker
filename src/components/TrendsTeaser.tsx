import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronRight, TrendingUp } from 'lucide-react'
import { db } from '@/db'
import type { Measurement } from '@/db/types'
import { measurementsByType } from '@/db/repo'
import { daysBetween, latestValue, trend } from '@/lib/measurements'
import { lastNDayKeys } from '@/lib/insights'
import { Card } from '@/components/ui/Card'

/**
 * Dezenter Verlauf-Teaser für „Heute" (Optik wie WeekBarsMini): der Verlauf ist
 * der Belohnungsmoment fürs Dranbleiben, liegt aber drei Ebenen tief — die
 * Karte ist das Sprungbrett zu /trends. Inhalt datenabhängig: ab 2 Gewichts-
 * Messwerten Mini-Sparkline + aktueller Wert + Wochentrend, sonst ab 3
 * Log-Tagen der Ø-kcal-Wert der letzten Woche. Ohne Daten rendert sie nichts.
 */

/** Sparkline-Fenster (~letzter Monat) bzw. Ø-Fenster (letzte Woche). */
const SPARK_DAYS = 30
const AVG_DAYS = 7
// Strichfarbe über Design-Token wie die übrigen Charts (TrendChart).
const PRIMARY = 'hsl(var(--primary))'

type TeaserData =
  | { kind: 'weight'; weights: Measurement[] }
  | { kind: 'kcal'; avg: number }
  | { kind: 'none' }

/** Schlichte Mini-Sparkline (nur Linie, keine Achsen), datumsproportional wie TrendChart. */
function Sparkline({ points }: { points: { date: string; value: number }[] }) {
  const W = 96
  const H = 28
  const pad = 3
  const minDate = points[0].date
  const maxDate = points[points.length - 1].date
  const totalDays = Math.max(1, daysBetween(minDate, maxDate))
  const values = points.map((p) => p.value)
  let yMin = Math.min(...values)
  let yMax = Math.max(...values)
  if (yMin === yMax) {
    // Flache Reihe: künstliche Spanne, damit die Linie mittig statt am Rand liegt.
    yMin -= 1
    yMax += 1
  }
  const xFor = (date: string) => pad + (daysBetween(minDate, date) / totalDays) * (W - 2 * pad)
  const yFor = (v: number) => pad + (1 - (v - yMin) / (yMax - yMin)) * (H - 2 * pad)
  const path = points.map((p) => `${xFor(p.date).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-24 shrink-0" aria-hidden="true">
      <polyline points={path} fill="none" stroke={PRIMARY} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Gemeinsamer Rahmen: ganze Karte tappbar (≥ 48 px, focus-ring) → /trends. */
function TeaserCard({ line, children }: { line: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Link to="/trends" className="focus-ring block rounded-lg">
      <Card className="flex min-h-[48px] items-center gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('trends.teaser.title')}</p>
          <p className="truncate text-sm font-medium tabular-nums">{line}</p>
        </div>
        {children}
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Card>
    </Link>
  )
}

export function TrendsTeaser({ today }: { today: string }) {
  const { t, i18n } = useTranslation()

  const data = useLiveQuery<TeaserData>(async () => {
    // Variante Gewicht: ab 2 Messwerten gibt es einen echten Verlauf zu zeigen.
    const weights = await measurementsByType('weight')
    if (weights.length >= 2) return { kind: 'weight', weights }
    // Variante Ø kcal: erst ab 3 verschiedenen Log-Tagen (vorher kein Teaser).
    // planned/deletedAt wie überall ausfiltern — Vorplanung ist kein Verzehr.
    // Full-Scan ist ok: dieser Zweig läuft nur in der Frühphase ohne Gewichtsdaten.
    const logs = await db.logs.filter((l) => !l.deletedAt && !l.planned).toArray()
    const distinctDays = new Set(logs.map((l) => l.date)).size
    if (distinctDays < 3) return { kind: 'none' }
    // Ø über die letzten 7 Tage — nur Tage zählen, an denen geloggt wurde.
    const window = new Set(lastNDayKeys(today, AVG_DAYS))
    const kcalByDay = new Map<string, number>()
    for (const l of logs) {
      if (window.has(l.date)) kcalByDay.set(l.date, (kcalByDay.get(l.date) ?? 0) + l.computed.kcal)
    }
    if (kcalByDay.size === 0) return { kind: 'none' }
    const total = [...kcalByDay.values()].reduce((a, b) => a + b, 0)
    return { kind: 'kcal', avg: total / kcalByDay.size }
  }, [today])

  // Laden oder zu wenig Daten → gar nichts rendern (kein leerer Teaser).
  if (!data || data.kind === 'none') return null

  if (data.kind === 'weight') {
    // Sparkline-Punkte: letzte ~30 Tage; liegt dort höchstens ein Punkt,
    // nehmen wir die letzten beiden Messwerte, damit immer eine Linie entsteht.
    const within = data.weights.filter((m) => {
      const d = daysBetween(m.date, today)
      return d >= 0 && d <= SPARK_DAYS
    })
    const points = (within.length >= 2 ? within : data.weights.slice(-2)).map((m) => ({ date: m.date, value: m.value }))
    // Wochentrend passend zur gezeichneten Linie: im Fenster über den
    // trend()-Helfer, sonst aus dem Fallback-Punktepaar (erster → letzter).
    const st = within.length >= 2 ? trend(data.weights, today, SPARK_DAYS) : null
    const first = points[0]
    const last = points[points.length - 1]
    const rate = st?.ratePerWeek ?? ((last.value - first.value) / Math.max(1, daysBetween(first.date, last.date))) * 7
    const latest = latestValue(data.weights)!
    const fmtKg = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const fmtRate = new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    })
    return (
      <TeaserCard line={t('trends.teaser.weightLine', { value: fmtKg.format(latest.value), rate: fmtRate.format(rate) })}>
        <Sparkline points={points} />
      </TeaserCard>
    )
  }

  return (
    <TeaserCard line={t('trends.teaser.kcalLine', { kcal: Math.round(data.avg) })}>
      <TrendingUp size={18} className="shrink-0 text-primary" aria-hidden="true" />
    </TeaserCard>
  )
}
