import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Droplet, Undo2 } from 'lucide-react'
import { db } from '@/db'
import { addWater, undoLastWater, waterGoalMl } from '@/db/repo'
import { todayKey } from '@/lib/utils'
import { Card } from '@/components/ui/Card'

const PRESETS = [250, 500]

/** Wasser-Tracking-Widget fürs Dashboard (PLAN.md §9 Komfort). */
export function WaterCard({ weightKg }: { weightKg?: number }) {
  const { t } = useTranslation()
  const date = todayKey()
  const entries = useLiveQuery(() => db.water.where('date').equals(date).toArray(), [date])
  const total = (entries ?? []).reduce((a, w) => a + w.ml, 0)
  const goal = waterGoalMl(weightKg)
  const pct = Math.min(total / goal, 1)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold">
          <Droplet size={18} className="text-primary" /> {t('today.water.title')}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t('today.water.amount', { current: total, goal })}
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      <div className="flex gap-2">
        {PRESETS.map((ml) => (
          <motion.button
            key={ml}
            whileTap={{ scale: 0.94 }}
            onClick={() => addWater(ml)}
            className="flex-1 rounded-xl bg-secondary py-2.5 text-sm font-medium text-secondary-foreground"
          >
            +{ml} ml
          </motion.button>
        ))}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => undoLastWater()}
          aria-label={t('today.water.undo')}
          disabled={total === 0}
          className="flex w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground disabled:opacity-40"
        >
          <Undo2 size={18} />
        </motion.button>
      </div>
    </Card>
  )
}
