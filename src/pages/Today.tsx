import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { db } from '@/db'
import { todayKey } from '@/lib/utils'
import { ProgressRing } from '@/components/ProgressRing'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'

const KCAL_GOAL = 2200 // Platzhalter bis Onboarding/Ziele (Phase 1)

export function Today() {
  const { t } = useTranslation()
  const date = todayKey()

  const logs = useLiveQuery(
    () => db.logs.where('date').equals(date).filter((l) => !l.deletedAt).toArray(),
    [date],
  )

  if (logs === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('today.title')} />
        <Skeleton className="mx-auto h-44 w-44 rounded-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const sum = logs.reduce(
    (acc, l) => ({
      kcal: acc.kcal + l.computed.kcal,
      protein: acc.protein + l.computed.protein,
      carbs: acc.carbs + l.computed.carbs,
      fat: acc.fat + l.computed.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

  const macros = [
    { key: 'protein', value: sum.protein },
    { key: 'carbs', value: sum.carbs },
    { key: 'fat', value: sum.fat },
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader title={t('today.title')} />

      <div className="flex flex-col items-center">
        <ProgressRing
          value={sum.kcal}
          max={KCAL_GOAL}
          label={String(Math.round(sum.kcal))}
          sublabel={t('today.kcalLeft', { count: Math.max(0, Math.round(KCAL_GOAL - sum.kcal)) })}
        />
      </div>

      <Card className="grid grid-cols-3 divide-x divide-border p-4">
        {macros.map((m) => (
          <div key={m.key} className="flex flex-col items-center px-2">
            <span className="text-lg font-semibold tabular-nums">{Math.round(m.value)} g</span>
            <span className="text-xs text-muted-foreground">{t(`today.macros.${m.key}`)}</span>
          </div>
        ))}
      </Card>

      {logs.length === 0 && (
        <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t('today.empty')}
        </p>
      )}
    </div>
  )
}
