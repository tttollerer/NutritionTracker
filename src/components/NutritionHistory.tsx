import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Target, Wallet } from 'lucide-react'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import { sumsByDate } from '@/lib/gamification'
import { lastNDayKeys, macroWeek, weeklyGoalHits, type GoalHits } from '@/lib/insights'
import { macroColor, type MacroKey } from '@/lib/macroColor'
import { useTodayKey } from '@/hooks/useTodayKey'
import { costByDate, formatEuro } from '@/lib/money'
import { TrendChart, type ChartSeries } from '@/components/TrendChart'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'

const CHART_DAYS = 14
const WEEK_DAYS = 7
const PRIMARY = 'hsl(var(--primary))'
/** Ab dieser Quote gilt die Woche fürs Ziel als „getroffen" (PLAN §7.5: 5/7). */
const WEEK_HIT_THRESHOLD = 5 / 7

/**
 * Ernährungs-Verlauf (PLAN.md §7.5): kcal-Tagesverlauf der letzten 14 Tage,
 * Makro-Wochenschnitt vs. Ziel und Wochen-Insights („an X von 7 Tagen
 * getroffen") aus sumsByDate + aktiven Zielen.
 */
export function NutritionHistory() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const today = useTodayKey() // reaktiv über Mitternacht (Befund 1)
  const days14 = lastNDayKeys(today, CHART_DAYS)
  const start = days14[0]

  const logs = useLiveQuery(
    // planned-Einträge (Wochenplan) sind kein Verzehr → nicht in der Historie.
    () => db.logs.where('date').between(start, today, true, true).filter((l) => !l.deletedAt && !l.planned).toArray(),
    [start, today],
  )
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])

  if (logs === undefined || goals === undefined) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-28 w-full" />
      </section>
    )
  }

  const heading = (
    <h2 className="text-sm font-semibold text-muted-foreground">{t('trends.nutrition.title')}</h2>
  )

  // Noch gar keine Logs im Fenster → freundlicher Einstieg statt leerer Charts.
  if (logs.length === 0) {
    return (
      <section className="space-y-3">
        {heading}
        <Card className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('trends.nutrition.empty')}</p>
          <Button onClick={() => navigate('/add')} className="mx-auto">
            <Plus size={18} /> {t('trends.nutrition.emptyCta')}
          </Button>
        </Card>
      </section>
    )
  }

  const sums = sumsByDate(logs)
  const days7 = days14.slice(-WEEK_DAYS)
  const week = macroWeek(sums, days7)
  const hits = weeklyGoalHits(sums, goals, days7)

  // Haushaltskasse: Kosten-Snapshots der letzten 7 Tage — Karte nur, wenn
  // überhaupt Preisdaten existieren (Feature bleibt sonst unsichtbar).
  const costs = costByDate(logs)
  const costDays7 = days7.filter((d) => costs[d] != null)
  const weekCost = Math.round(costDays7.reduce((a, d) => a + costs[d], 0) * 100) / 100
  const avgCost = costDays7.length ? weekCost / costDays7.length : 0

  const kcalPoints = days14
    .filter((d) => sums[d])
    .map((d) => ({ date: d, value: Math.round(sums[d].kcal) }))
  const kcalSeries: ChartSeries[] = [{ points: kcalPoints, color: PRIMARY, label: 'kcal' }]

  const macros: { key: MacroKey; value: number; target?: number }[] = [
    { key: 'protein', value: week.avg.protein, target: goals.protein?.target },
    { key: 'carbs', value: week.avg.carbs, target: goals.carbs?.target },
    { key: 'fat', value: week.avg.fat, target: goals.fat?.target },
  ]

  return (
    <section className="space-y-3">
      {heading}

      {/* kcal-Tagesverlauf (14 Tage) */}
      <Card className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">{t('trends.nutrition.kcalTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('trends.nutrition.kcalSubtitle')}</p>
        </div>
        {kcalPoints.length >= 2 ? (
          <TrendChart series={kcalSeries} decimals={0} />
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{kcalPoints[0].value}</span> kcal
            <span className="ml-2 text-xs">{t('trends.tooFew')}</span>
          </p>
        )}
      </Card>

      {/* Makro-Wochenschnitt vs. Ziel */}
      <Card className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">{t('trends.nutrition.macroTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('trends.nutrition.macroSubtitle')}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">Ø {Math.round(week.avg.kcal)}</span>{' '}
          {t('trends.nutrition.kcalPerDay')}
          <span className="ml-1 text-xs">
            · {t('trends.nutrition.loggedDays', { logged: week.loggedDays, total: WEEK_DAYS })}
          </span>
        </p>
        {macros.map((m) => {
          const pct = m.target ? Math.min(m.value / m.target, 1) : 0
          return (
            <div key={m.key} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">{t(`today.macros.${m.key}`)}</span>
                <span className="tabular-nums">
                  Ø {Math.round(m.value)}
                  {m.target ? ` / ${m.target}` : ''} g
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${macroColor(m.key)}`}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </Card>

      {/* Haushaltskasse: Ø Essenskosten/Tag + Wochensumme (nur mit Preisdaten) */}
      {weekCost > 0 && (
        <Card className="space-y-2 p-4">
          <p className="flex items-center gap-2 font-medium">
            <Wallet size={16} aria-hidden className="text-muted-foreground" />
            {t('trends.budget.title')}
          </p>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{t('trends.budget.avgPerDay')}</span>
            <span className="tabular-nums font-medium">Ø {formatEuro(avgCost)}</span>
          </div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{t('trends.budget.weekSum')}</span>
            <span className="tabular-nums font-medium">{formatEuro(weekCost)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('trends.budget.days', { count: costDays7.length })}
          </p>
        </Card>
      )}

      {/* Wochen-Insights: Ziel an X von 7 Tagen getroffen */}
      <Card className="space-y-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <Target size={16} aria-hidden className="text-muted-foreground" />
          {t('trends.nutrition.insightsTitle')}
        </p>
        {hits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('trends.nutrition.noGoals')}</p>
        ) : (
          hits.map((h) => <GoalHitRow key={h.nutrient} hit={h} />)
        )}
      </Card>
    </section>
  )
}

function GoalHitRow({ hit }: { hit: GoalHits }) {
  const { t } = useTranslation()
  const good = hit.hits / hit.total >= WEEK_HIT_THRESHOLD
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">
        {t(`trends.nutrition.nutrients.${hit.nutrient}`)}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {/* 7-Tage-Punkte: gefüllt = Ziel an dem Tag getroffen */}
        <span className="flex items-center gap-1" aria-hidden>
          {hit.metByDay.map((met, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${met ? 'bg-success' : 'bg-muted'}`} />
          ))}
        </span>
        <span className={`tabular-nums text-xs font-medium ${good ? 'text-success-text' : 'text-muted-foreground'}`}>
          {t('trends.nutrition.goalHits', { hits: hit.hits, total: hit.total })}
        </span>
      </span>
    </div>
  )
}
