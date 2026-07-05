import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Trash2, Trophy } from 'lucide-react'
import { db } from '@/db'
import type { FoodItem, LogEntry, Photo } from '@/db/types'
import { deleteLog, getActiveGoalsMap, getAllergies, getSettings, restoreLog } from '@/db/repo'
import { useOverlays } from '@/lib/overlays-context'
import { EditLogSheet } from '@/components/EditLogSheet'
import { DIABETES_SUGAR_LIMIT_G } from '@/lib/glucose'
import { activeChallenges, evaluateChallenge } from '@/lib/challenges'
import { todayKey } from '@/lib/utils'
import { MEALS } from '@/lib/meal'
import { macroColor } from '@/lib/macroColor'
import { ProgressRing } from '@/components/ProgressRing'
import { WaterCard } from '@/components/WaterCard'
import { NutrientPanel } from '@/components/NutrientPanel'
import { GlucoseCard } from '@/components/GlucoseCard'
import { DueMeasurements } from '@/components/DueMeasurements'
import { NudgeCard } from '@/components/NudgeCard'
import { CaptureCta } from '@/components/CaptureCta'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'

export function Today() {
  const { t } = useTranslation()
  const date = todayKey()
  const { showUndo } = useOverlays()
  const [editing, setEditing] = useState<LogEntry | null>(null)

  const logs = useLiveQuery(
    () => db.logs.where('date').equals(date).filter((l) => !l.deletedAt).toArray(),
    [date],
  )
  // Gezielt nur die Foods/Fotos der Tages-Logs laden (bulkGet) statt alle Stores.
  const foods = useLiveQuery(async () => {
    if (!logs) return undefined
    const ids = [...new Set(logs.map((l) => l.foodId))]
    const items = await db.foods.bulkGet(ids)
    return new Map(items.filter((f): f is FoodItem => !!f).map((f) => [f.id, f]))
  }, [logs])
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  const profile = useLiveQuery(() => db.profile.get('me'), [])
  const photos = useLiveQuery(async () => {
    if (!logs) return undefined
    const ids = [...new Set(logs.flatMap((l) => (l.photoBlobId ? [l.photoBlobId] : [])))]
    const items = await db.photos.bulkGet(ids)
    return new Map(items.filter((p): p is Photo => !!p).map((p) => [p.id, p.dataUrl]))
  }, [logs])
  const allergies = useLiveQuery(() => getAllergies(), [])
  const settings = useLiveQuery(() => getSettings(), [])
  const challenges = useLiveQuery(() => activeChallenges(), [])

  if (logs === undefined || foods === undefined || goals === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('today.title')} />
        <Skeleton className="mx-auto h-44 w-44 rounded-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const foodName = (id: string) => foods.get(id)?.name ?? '—'
  const photoUrl = (id?: string) => (id ? photos?.get(id) : undefined)

  // Soft-Delete mit Undo-Snackbar: der Eintrag ist per restoreLog wiederherstellbar.
  function handleDelete(l: LogEntry) {
    void deleteLog(l.id)
    showUndo(t('today.entryDeleted', { name: foodName(l.foodId) }), () => restoreLog(l.id))
  }

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
  const weightKg = profile?.weightKg
  const macros = [
    { key: 'protein', value: sum.protein, target: goals.protein?.target },
    { key: 'carbs', value: sum.carbs, target: goals.carbs?.target },
    { key: 'fat', value: sum.fat, target: goals.fat?.target },
  ] as const

  // Zielabhängiges kcal-Framing: beim Zunehmen ist „mehr" gewollt → „noch bis Ziel".
  const kcalDiff = Math.round(kcalGoal - sum.kcal)
  const kcalSublabel =
    profile?.goal === 'gain'
      ? kcalDiff > 0
        ? t('today.kcalToGoal', { count: kcalDiff })
        : t('today.kcalReached')
      : t('today.kcalLeft', { count: Math.max(0, kcalDiff) })

  return (
    <div className="space-y-6">
      <PageHeader title={t('today.title')} />

      <CaptureCta />

      <DueMeasurements />

      <NudgeCard
        logs={logs}
        date={date}
        proteinTarget={goals.protein?.target}
        sex={profile?.sex}
        vegan={profile?.dietForms.includes('vegan')}
        allergies={allergies}
        sugarLimit={settings?.sugarWarner ? DIABETES_SUGAR_LIMIT_G : undefined}
      />

      {/* Aktive Coach-Challenges kompakt anzeigen (Details & Aktionen: Erfolge). */}
      {challenges && challenges.length > 0 && (
        <Card className="space-y-2 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Trophy size={16} className="text-warning" aria-hidden />
            {t('today.challenges')}
          </h2>
          {challenges.map((c) => {
            const p = evaluateChallenge(c, { [date]: sum }, date)
            const dayProgress = p?.kind === 'day' ? p : null
            return (
              <div key={c.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{c.title}</span>
                  {dayProgress && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {dayProgress.current} / {dayProgress.target} {dayProgress.unit ?? ''}
                    </span>
                  )}
                </div>
                {dayProgress && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className={`h-full rounded-full ${dayProgress.met ? 'bg-success' : 'bg-brand-gradient'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${dayProgress.pct * 100}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}

      <div className="flex flex-col items-center">
        <ProgressRing
          value={sum.kcal}
          max={kcalGoal}
          label={String(Math.round(sum.kcal))}
          sublabel={kcalSublabel}
        />
      </div>

      <Card className="space-y-3 p-4">
        {macros.map((m) => {
          const pct = m.target ? m.value / m.target : 0
          const isProtein = m.key === 'protein'
          // Protein ist ein Mindest-Ziel: Übererfüllung ist erwünscht → grün + „+X g".
          const reached = isProtein && m.target != null && m.value >= m.target
          const over = m.target ? Math.max(0, m.value - m.target) : 0
          return (
            <div key={m.key} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">
                  {t(`today.macros.${m.key}`)}
                  {isProtein && weightKg ? (
                    <span className="ml-1 text-xs text-muted-foreground">· {(m.value / weightKg).toFixed(1)} g/kg</span>
                  ) : null}
                </span>
                <span className="tabular-nums">
                  {Math.round(m.value)}
                  {m.target ? ` / ${m.target}` : ''} g
                  {reached && over >= 1 && <span className="ml-1 font-medium text-success-text">+{Math.round(over)}</span>}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className={`h-full rounded-full ${reached ? 'bg-success' : macroColor(m.key)}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(pct, 1) * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
          )
        })}
      </Card>

      <NutrientPanel
        logs={logs}
        date={date}
        proteinTarget={goals.protein?.target}
        sex={profile?.sex}
        vegan={profile?.dietForms.includes('vegan')}
        allergies={allergies}
        sugarLimit={settings?.sugarWarner ? DIABETES_SUGAR_LIMIT_G : undefined}
      />

      {settings?.bloodSugar && <GlucoseCard unit={settings.glucoseUnit} date={date} />}

      <WaterCard weightKg={profile?.weightKg} />

      {logs.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t('today.empty')}
        </p>
      ) : (
        <div className="space-y-4">
          {MEALS.map((meal) => {
            const items = logs.filter((l) => l.meal === meal)
            if (items.length === 0) return null
            const mealKcal = items.reduce((a, l) => a + l.computed.kcal, 0)
            const mealProtein = items.reduce((a, l) => a + l.computed.protein, 0)
            return (
              <section key={meal} className="space-y-2">
                <h2 className="flex items-baseline justify-between text-sm font-semibold text-muted-foreground">
                  <span>{t(`today.meals.${meal}`)}</span>
                  <span className="text-xs font-normal tabular-nums">
                    {Math.round(mealKcal)} kcal · {Math.round(mealProtein)} g {t('today.macros.protein')}
                  </span>
                </h2>
                <AnimatePresence initial={false}>
                  {items.map((l) => (
                    <motion.div
                      key={l.id}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                    >
                      <button
                        onClick={() => setEditing(l)}
                        aria-label={t('today.edit.open', { name: foodName(l.foodId) })}
                        className="focus-ring flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                      >
                        {photoUrl(l.photoBlobId) && (
                          <img
                            src={photoUrl(l.photoBlobId)}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded-lg object-cover"
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{foodName(l.foodId)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {l.amount} {l.unit === 'portion' ? t('today.edit.unitPortion') : l.unit} · {Math.round(l.computed.kcal)} kcal
                          </span>
                        </span>
                      </button>
                      <button
                        aria-label={t('common.delete')}
                        onClick={() => handleDelete(l)}
                        className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
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

      <EditLogSheet
        entry={editing}
        food={editing ? foods.get(editing.foodId) : undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
