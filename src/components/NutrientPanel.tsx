import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Plus, ChevronDown } from 'lucide-react'
import type { LogEntry } from '@/db/types'
import { computeDayNutrition, rankDeficits } from '@/lib/deficit'
import { recommendFoods } from '@/lib/recommend'
import { CATALOG_BY_ID } from '@/lib/foodCatalog'
import { quickLogCatalog } from '@/db/repo'
import { defaultMeal } from '@/lib/meal'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'

interface Props {
  logs: LogEntry[]
  date: string
  proteinTarget?: number
  sex?: 'm' | 'f'
  vegan?: boolean
  allergies?: string[]
}

/** Nährstoff-Defizite, Limit-„Laster" und deterministische Essens-Empfehlungen. */
export function NutrientPanel({ logs, date, proteinTarget, sex, vegan, allergies }: Props) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  const day = computeDayNutrition(logs, date, { proteinTarget, sex, vegan })
  const deficits = rankDeficits(day)
  const recs = recommendFoods(deficits, { vegan, allergies, limit: 3 })

  // Benefits mit echtem Konsum oder offenem Defizit; sonst ausgeblendet bis "mehr".
  const benefits = day.benefits.filter((b) => showAll || b.consumed > 0 || b.remaining > 0)
  const limitsActive = day.limits.filter((l) => l.consumed > 0)

  const label = (k: string) => t(`nutrients.names.${k}`, { defaultValue: k })

  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold">{t('nutrients.title')}</h2>

      {/* Benefit-Nährstoffe */}
      <div className="space-y-2.5">
        {benefits.map((b) => {
          const reached = b.remaining <= 0
          return (
            <div key={b.key} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label(b.key)}</span>
                <span className={cn('tabular-nums', reached ? 'text-success' : '')}>
                  {reached
                    ? t('nutrients.reached')
                    : t('nutrients.remaining', { amount: fmt(b.remaining), unit: b.unit })}
                </span>
              </div>
              <Bar pct={b.pct} tone="primary" />
            </div>
          )
        })}
        <button
          onClick={() => setShowAll((s) => !s)}
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <ChevronDown size={14} className={showAll ? 'rotate-180' : ''} />
          {showAll ? 'weniger' : 'alle Nährstoffe'}
        </button>
      </div>

      {/* Limits / Laster */}
      {limitsActive.length > 0 && (
        <div className="space-y-2.5 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">{t('nutrients.limitsTitle')}</h3>
          {limitsActive.map((l) => {
            const over = l.remaining < 0
            return (
              <div key={l.key} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label(l.key)}</span>
                  <span className={cn('tabular-nums', over ? 'text-destructive' : '')}>
                    {over
                      ? t('nutrients.over', { amount: fmt(-l.remaining), unit: l.unit })
                      : t('nutrients.ofLimit', { current: fmt(l.consumed), limit: l.target, unit: l.unit })}
                  </span>
                </div>
                <Bar pct={l.pct} tone={over ? 'destructive' : 'warning'} />
              </div>
            )
          })}
        </div>
      )}

      {/* Empfehlungen */}
      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">{t('nutrients.recommendTitle')}</h3>
        {recs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('nutrients.recommendNone')}</p>
        ) : (
          recs.map(({ food, covers }) => (
            <motion.button
              key={food.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => quickLogCatalog(CATALOG_BY_ID[food.id], defaultMeal(), date)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 text-left"
            >
              <span className="min-w-0">
                <span className="block font-medium">
                  {food.name} · {food.serving} {food.per}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('nutrients.covers')} {covers.map((c) => `${label(c.key)} +${fmt(c.amount)}${c.unit}`).join(', ')}
                </span>
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Plus size={18} />
              </span>
            </motion.button>
          ))
        )}
      </div>
    </Card>
  )
}

function Bar({ pct, tone }: { pct: number; tone: 'primary' | 'warning' | 'destructive' }) {
  const color = tone === 'destructive' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning' : 'bg-primary'
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <motion.div
        className={cn('h-full rounded-full', color)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(pct, 1) * 100}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  )
}

function fmt(n: number) {
  return Math.round(n * 10) / 10
}
