import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Lightbulb, AlertTriangle, PartyPopper, Plus, X } from 'lucide-react'
import type { LogEntry } from '@/db/types'
import { computeDayNutrition, rankDeficits } from '@/lib/deficit'
import { recommendFoods } from '@/lib/recommend'
import { buildNudge, type NudgeTone } from '@/lib/nudge'
import { CATALOG_BY_ID } from '@/lib/foodCatalog'
import { deleteLog, quickLogCatalog } from '@/db/repo'
import { defaultMeal } from '@/lib/meal'
import { useOverlays } from '@/lib/overlays-context'
import { cn } from '@/lib/utils'

interface Props {
  logs: LogEntry[]
  date: string
  proteinTarget?: number
  sex?: 'm' | 'f'
  vegan?: boolean
  allergies?: string[]
  sugarLimit?: number
  /** Aktuelle Stunde (injizierbar für Tests); Default = jetzt. */
  hour?: number
}

const TONE: Record<NudgeTone, { icon: typeof Lightbulb; box: string; iconCls: string }> = {
  info: { icon: Lightbulb, box: 'border-primary/30 bg-primary/5', iconCls: 'bg-primary/15 text-primary' },
  warn: { icon: AlertTriangle, box: 'border-destructive/30 bg-destructive/10', iconCls: 'bg-destructive/15 text-destructive' },
  success: { icon: PartyPopper, box: 'border-success/30 bg-success/10', iconCls: 'bg-success/15 text-success' },
}

/** Dezenter, proaktiver Hinweis auf „Heute" — datenbasiert, ohne LLM, einklappbar. */
export function NudgeCard({ logs, date, proteinTarget, sex, vegan, allergies, sugarLimit, hour }: Props) {
  const { t } = useTranslation()
  const { showUndo } = useOverlays()
  const [dismissed, setDismissed] = useState(false)

  const day = computeDayNutrition(logs, date, {
    proteinTarget,
    sex,
    vegan,
    limitOverrides: sugarLimit ? { sugar: sugarLimit } : undefined,
  })
  const deficits = rankDeficits(day)
  const topRec = recommendFoods(deficits, { vegan, allergies, limit: 1 })[0]
  const hasLoggedToday = logs.some((l) => l.date === date && !l.deletedAt)
  const h = hour ?? new Date().getHours()

  const nudge = buildNudge({ hour: h, hasLoggedToday, day, deficits, topRec })
  if (!nudge || dismissed) return null

  const nutrientName = (k?: string) => (k ? t(`nutrients.names.${k}`, { defaultValue: k }) : '')
  const message = t(`nudge.${nudge.type}`, {
    ...nudge.params,
    nutrient: nutrientName(nudge.params?.nutrient as string | undefined),
  })
  const tone = TONE[nudge.tone]
  const Icon = tone.icon

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn('flex items-start gap-3 rounded-2xl border p-4', tone.box)}
      >
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone.iconCls)}>
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">{message}</p>
          {nudge.foodId && CATALOG_BY_ID[nudge.foodId] && (
            <button
              onClick={async () => {
                const name = nudge.foodName ?? ''
                const entry = await quickLogCatalog(CATALOG_BY_ID[nudge.foodId!], defaultMeal(), date)
                setDismissed(true)
                showUndo(t('capture.added', { name }), () => deleteLog(entry.id))
              }}
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Plus size={14} /> {nudge.foodName} · {CATALOG_BY_ID[nudge.foodId].serving} {CATALOG_BY_ID[nudge.foodId].per}
            </button>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label={t('common.cancel')}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
