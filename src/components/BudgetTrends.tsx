import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Tag, Wallet } from 'lucide-react'
import { db } from '@/db'
import { getSettings } from '@/db/repo'
import type { FoodItem } from '@/db/types'
import { budgetProgress, costsByTag, kcalPrice, proteinPricePerFood, topCostTags, UNTAGGED, type FoodPriceRank } from '@/lib/budget'
import { costByDate, formatEuro } from '@/lib/money'
import { lastNDayKeys } from '@/lib/insights'
import { useTodayKey } from '@/hooks/useTodayKey'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

const WEEK_DAYS = 7
const TOP_TAGS = 5
const TOP_RANKED = 5

/**
 * Haushaltskasse auf der Trends-Seite: € pro Tag (7-Tage-Balken) mit
 * Budget-Abgleich, Ausgaben je Kategorie (erste Tags, Top 5) und
 * „Preis-Leistung" — €/100 g Protein bzw. €/1000 kcal über Vorrat/Favoriten.
 */
export function BudgetTrends() {
  const { t, i18n } = useTranslation()
  const today = useTodayKey()
  const days7 = lastNDayKeys(today, WEEK_DAYS)
  const start = days7[0]

  // Nur Logs mit Kosten-Snapshot — alles andere trägt hier nichts bei.
  const logs = useLiveQuery(
    () =>
      db.logs
        .where('date')
        .between(start, today, true, true)
        .filter((l) => !l.deletedAt && !l.planned && l.cost != null)
        .toArray(),
    [start, today],
  )
  const foods = useLiveQuery(async () => {
    if (!logs) return undefined
    const ids = [...new Set(logs.map((l) => l.foodId))]
    return (await db.foods.bulkGet(ids)).filter((f): f is FoodItem => !!f)
  }, [logs])
  // Preis-Leistung: nur Vorrat/Favoriten mit hinterlegtem Packungspreis.
  const rankFoods = useLiveQuery(
    () => db.foods.filter((f) => !f.deletedAt && !!f.price && (f.pantry === true || f.favorite === true)).toArray(),
    [],
  )
  const settings = useLiveQuery(() => getSettings(), [])

  if (logs === undefined || foods === undefined || rankFoods === undefined || settings === undefined) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-40 w-full" />
      </section>
    )
  }

  const costs = costByDate(logs)
  const costDays = days7.filter((d) => costs[d] != null)
  const weekCost = Math.round(costDays.reduce((a, d) => a + costs[d], 0) * 100) / 100
  const avgCost = costDays.length ? weekCost / costDays.length : 0
  const budget = budgetProgress(weekCost, settings.weeklyBudget)

  const tagCosts = topCostTags(costsByTag(logs, foods), TOP_TAGS)
  const proteinRank = proteinPricePerFood(rankFoods).slice(0, TOP_RANKED)
  const kcalRank = kcalPrice(rankFoods).slice(0, TOP_RANKED)

  // Ohne jegliche Preisdaten bleibt das Feature unsichtbar (wie bisher).
  if (weekCost <= 0 && proteinRank.length === 0 && kcalRank.length === 0) return null

  const fmtWeekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
  const maxDayCost = Math.max(...days7.map((d) => costs[d] ?? 0), 0.01)
  const maxTagCost = Math.max(...tagCosts.map(([, v]) => v), 0.01)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('trends.budget.title')}</h2>

      {/* € pro Tag: 7-Tage-Balken + Ø/Summe + Budget-Fortschritt */}
      {weekCost > 0 && (
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 font-medium">
            <Wallet size={16} aria-hidden className="text-muted-foreground" />
            {t('budget.perDay')}
          </p>
          <div className="flex items-end gap-1.5" aria-label={t('budget.perDay')}>
            {days7.map((d) => {
              const v = costs[d] ?? 0
              const date = new Date(`${d}T12:00:00`)
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1" title={`${fmtWeekday.format(date)} ${formatEuro(v)}`}>
                  <div className="flex h-16 w-full items-end">
                    <div
                      className={cn('w-full rounded-t', v > 0 ? 'bg-primary' : 'bg-muted')}
                      style={{ height: v > 0 ? `${Math.max(6, (v / maxDayCost) * 100)}%` : '4px' }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {fmtWeekday.format(date).replace(/\.$/, '')}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{t('trends.budget.avgPerDay')}</span>
            <span className="font-mono font-medium tabular-nums">Ø {formatEuro(avgCost)}</span>
          </div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{t('trends.budget.weekSum')}</span>
            <span className={cn('font-mono font-medium tabular-nums', budget?.over && 'text-warning-text')}>
              {formatEuro(weekCost)}
            </span>
          </div>
          {budget && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', budget.over ? 'bg-warning' : 'bg-primary')}
                  style={{ width: `${budget.ratio * 100}%` }}
                />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t('budget.spentOfBudget', { spent: formatEuro(weekCost), budget: formatEuro(settings.weeklyBudget!) })}
                {' · '}
                <span className={cn(budget.over && 'font-medium text-warning-text')}>
                  {t(budget.over ? 'budget.over' : 'budget.left', { amount: formatEuro(budget.diff) })}
                </span>
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('trends.budget.days', { count: costDays.length })}</p>
        </Card>
      )}

      {/* Ausgaben je Kategorie (erster Tag des Lebensmittels, Top 5) */}
      {tagCosts.length > 0 && (
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 font-medium">
            <Tag size={16} aria-hidden className="text-muted-foreground" />
            {t('budget.byTag')}
          </p>
          {tagCosts.map(([tag, cost]) => (
            <div key={tag} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">
                  {tag === UNTAGGED ? t('budget.untagged') : tag}
                </span>
                <span className="shrink-0 font-mono tabular-nums">{formatEuro(cost)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(cost / maxTagCost) * 100}%` }} />
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Preis-Leistung über Vorrat/Favoriten — nur Foods mit Preisdaten */}
      {(proteinRank.length > 0 || kcalRank.length > 0) && (
        <Card className="space-y-4 p-4">
          <p className="font-medium">{t('budget.pricePerformance')}</p>
          {proteinRank.length > 0 && (
            <PriceRankList title={t('budget.proteinPrice')} hint={t('budget.proteinPriceHint')} ranked={proteinRank} />
          )}
          {kcalRank.length > 0 && (
            <PriceRankList title={t('budget.kcalPrice')} hint={t('budget.kcalPriceHint')} ranked={kcalRank} />
          )}
        </Card>
      )}
    </section>
  )
}

/** Ranking-Liste (günstigste zuerst) mit mono-formatierten EUR-Werten. */
function PriceRankList({ title, hint, ranked }: { title: string; hint: string; ranked: FoodPriceRank[] }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ol className="space-y-1.5">
        {ranked.map((r, i) => (
          <li key={r.food.id} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
              {r.food.name}
            </span>
            <span className="shrink-0 font-mono font-medium tabular-nums">{formatEuro(r.price)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
