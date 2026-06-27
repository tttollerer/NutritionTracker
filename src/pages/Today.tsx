import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { db } from '@/db'
import { deleteLog, getActiveGoalsMap } from '@/db/repo'
import { todayKey } from '@/lib/utils'
import { MEALS } from '@/lib/meal'
import { ProgressRing } from '@/components/ProgressRing'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'

export function Today() {
  const { t } = useTranslation()
  const date = todayKey()

  const logs = useLiveQuery(
    () => db.logs.where('date').equals(date).filter((l) => !l.deletedAt).toArray(),
    [date],
  )
  const foods = useLiveQuery(() => db.foods.toArray(), [])
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])

  if (logs === undefined || foods === undefined || goals === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('today.title')} />
        <Skeleton className="mx-auto h-44 w-44 rounded-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const foodName = (id: string) => foods.find((f) => f.id === id)?.name ?? '—'

  const sum = logs.reduce(
    (a, l) => ({
      kcal: a.kcal + l.computed.kcal,
      protein: a.protein + l.computed.protein,
      carbs: a.carbs + l.computed.carbs,
      fat: a.fat + l.computed.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

  const kcalGoal = goals.kcal?.target ?? 2200
  const macros = [
    { key: 'protein', value: sum.protein, target: goals.protein?.target },
    { key: 'carbs', value: sum.carbs, target: goals.carbs?.target },
    { key: 'fat', value: sum.fat, target: goals.fat?.target },
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader title={t('today.title')} />

      <div className="flex flex-col items-center">
        <ProgressRing
          value={sum.kcal}
          max={kcalGoal}
          label={String(Math.round(sum.kcal))}
          sublabel={t('today.kcalLeft', { count: Math.max(0, Math.round(kcalGoal - sum.kcal)) })}
        />
      </div>

      <Card className="space-y-3 p-4">
        {macros.map((m) => {
          const pct = m.target ? Math.min(m.value / m.target, 1) : 0
          return (
            <div key={m.key} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t(`today.macros.${m.key}`)}</span>
                <span className="tabular-nums">
                  {Math.round(m.value)}
                  {m.target ? ` / ${m.target}` : ''} g
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
          )
        })}
      </Card>

      {logs.length === 0 ? (
        <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t('today.empty')}
        </p>
      ) : (
        <div className="space-y-4">
          {MEALS.map((meal) => {
            const items = logs.filter((l) => l.meal === meal)
            if (items.length === 0) return null
            return (
              <section key={meal} className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {t(`today.meals.${meal}`)}
                </h2>
                <AnimatePresence initial={false}>
                  {items.map((l) => (
                    <motion.div
                      key={l.id}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center justify-between rounded-xl border border-border bg-card p-3"
                    >
                      <span>
                        <span className="font-medium">{foodName(l.foodId)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {l.amount} {l.unit} · {Math.round(l.computed.kcal)} kcal
                        </span>
                      </span>
                      <button
                        aria-label={t('common.delete')}
                        onClick={() => deleteLog(l.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={18} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
