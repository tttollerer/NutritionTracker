import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db'
import type { FoodItem, LogEntry, Meal, Photo } from '@/db/types'
import { computeLogValues, deleteLog, getActiveGoalsMap, getSettings, pantryFoods, restoreLog } from '@/db/repo'
import { budgetProgress } from '@/lib/budget'
import { formatEuro, sumCost } from '@/lib/money'
import { MEALS } from '@/lib/meal'
import {
  confirmPlanned,
  missingForPlan,
  missingToShoppingList,
  planFood,
  sumPlannedCost,
} from '@/lib/planning'
import { removeShoppingItem } from '@/lib/shopping'
import { describePortion } from '@/lib/portion'
import { cn, todayKey } from '@/lib/utils'
import { useTodayKey } from '@/hooks/useTodayKey'
import { useOverlays } from '@/lib/overlays-context'
import { PageHeader } from '@/components/PageHeader'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Skeleton } from '@/components/ui/Skeleton'

/** Montag der Woche, in der `d` liegt (deutsche Wochenkonvention). */
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const shift = (out.getDay() + 6) % 7 // So=0 → 6, Mo=1 → 0, …
  out.setDate(out.getDate() - shift)
  return out
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

/**
 * Wochenplaner (Design 1b): Rückblick „was wurde die Woche gegessen" mit
 * echtem Tag-Swipe. Tag-Strip zum Springen, horizontale Scroll-Snap-Panels
 * (ein Panel je Tag) und Wochen-Summe (Ø kcal · Mahlzeiten · Kosten) unten.
 * Leere Tage bieten den Vorausplan-Einstieg „Aus Vorrat planen".
 */
export function Week() {
  const { t, i18n } = useTranslation()
  const { openCapture, showUndo } = useOverlays()
  const today = useTodayKey()
  // 0 = aktuelle Woche, -1 = vorherige, … (Chevrons im Header).
  const [weekOffset, setWeekOffset] = useState(0)
  // Zukunfts-Tag, für den gerade der Vorrats-Picker (PlanSheet) offen ist.
  const [planFor, setPlanFor] = useState<string | null>(null)

  const days = useMemo(() => {
    const monday = mondayOf(addDays(new Date(`${today}T12:00:00`), weekOffset * 7))
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i)
      return { date, key: todayKey(date) }
    })
  }, [today, weekOffset])

  const firstKey = days[0].key
  const lastKey = days[6].key

  const logs = useLiveQuery(
    () =>
      db.logs
        .where('date')
        .between(firstKey, lastKey, true, true)
        // planned-Einträge (Wochenplan) zählen nicht als Verzehr — sie werden
        // im Planer separat geladen/gerendert (plannedForDate).
        .filter((l) => !l.deletedAt && !l.planned)
        .toArray(),
    [firstKey, lastKey],
  )
  // Vorgeplante Mahlzeiten der Woche (Wochenplaner) — separat von den echten Logs.
  const plannedLogs = useLiveQuery(
    () =>
      db.logs
        .where('date')
        .between(firstKey, lastKey, true, true)
        .filter((l) => !l.deletedAt && !!l.planned)
        .toArray(),
    [firstKey, lastKey],
  )
  const foods = useLiveQuery(async () => {
    if (!logs || !plannedLogs) return undefined
    const ids = [...new Set([...logs, ...plannedLogs].map((l) => l.foodId))]
    const items = await db.foods.bulkGet(ids)
    return new Map(items.filter((f): f is FoodItem => !!f).map((f) => [f.id, f]))
  }, [logs, plannedLogs])
  // Fehlende Plan-Zutaten je Zukunfts-Tag (Hinweis „N Zutaten fehlen im Vorrat").
  const missingByDay = useLiveQuery(async () => {
    const entries = await Promise.all(
      days.map(async (d) => [d.key, d.key > today ? await missingForPlan(d.key) : []] as const),
    )
    return new Map(entries)
  }, [firstKey, today])
  const photos = useLiveQuery(async () => {
    if (!logs) return undefined
    const ids = [...new Set(logs.flatMap((l) => (l.photoBlobId ? [l.photoBlobId] : [])))]
    const items = await db.photos.bulkGet(ids)
    return new Map(items.filter((p): p is Photo => !!p).map((p) => [p.id, p.dataUrl]))
  }, [logs])
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  const settings = useLiveQuery(() => getSettings(), [])

  // Fokussierter Tag: heute (aktuelle Woche) bzw. Montag (andere Wochen).
  const todayIdx = days.findIndex((d) => d.key === today)
  const initialIdx = todayIdx >= 0 ? todayIdx : 0
  const [activeIdx, setActiveIdx] = useState(initialIdx)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Solange Daten laden, rendert die Seite nur Skeletons — den Scroll-Container
  // gibt es erst mit `ready`. Der Fokus-Effekt muss daher auf ready reagieren,
  // sonst startet die Woche immer auf Montag statt heute.
  const ready =
    logs !== undefined &&
    plannedLogs !== undefined &&
    foods !== undefined &&
    missingByDay !== undefined &&
    goals !== undefined &&
    settings !== undefined
  // Beim Wochenwechsel/Laden Fokus setzen (ohne Animation ans Ziel springen).
  useEffect(() => {
    setActiveIdx(initialIdx)
    const el = scrollRef.current
    if (el) el.scrollLeft = initialIdx * el.clientWidth
  }, [initialIdx, firstKey, ready])

  // Scroll-Position → aktiver Chip (rAF-gedrosselt wie im Prototyp).
  const rafRef = useRef<number | null>(null)
  const onScroll = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el || el.clientWidth === 0) return
      const idx = Math.round(el.scrollLeft / el.clientWidth)
      setActiveIdx(Math.max(0, Math.min(6, idx)))
    })
  }, [])
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  function jumpTo(idx: number) {
    const el = scrollRef.current
    if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
    setActiveIdx(idx)
  }

  if (
    !ready ||
    logs === undefined ||
    plannedLogs === undefined ||
    foods === undefined ||
    missingByDay === undefined ||
    goals === undefined ||
    settings === undefined
  ) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('week.title')} />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const kcalGoal = goals.kcal?.target ?? 2200
  const fmtDay = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
  const fmtWeekdayShort = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
  const fmtWeekdayLong = new Intl.DateTimeFormat(i18n.language, { weekday: 'long' })
  // „7.–13. Juli" — Monat nur am Ende (bei Monatswechsel automatisch beide voll).
  const sameMonth = days[0].date.getMonth() === days[6].date.getMonth()
  const range = t('week.range', {
    from: sameMonth ? `${days[0].date.getDate()}.` : fmtDay.format(days[0].date),
    to: fmtDay.format(days[6].date),
  })

  const byDay = days.map((d) => logs.filter((l) => l.date === d.key))
  const kcalByDay = byDay.map((dayLogs) => dayLogs.reduce((a, l) => a + l.computed.kcal, 0))
  const plannedByDay = days.map((d) => plannedLogs.filter((l) => l.date === d.key))

  // „Gegessen ✓": bestätigen; Undo stellt den Plan-Snapshot exakt wieder her
  // (confirmPlanned rechnet computed/cost neu — l ist der Stand davor).
  async function confirmEntry(l: LogEntry) {
    const confirmed = await confirmPlanned(l.id)
    if (!confirmed) return
    showUndo(t('plan.confirmed'), async () => {
      await db.logs.put({ ...l, updatedAt: Date.now() })
    })
  }

  // Planung entfernen: Soft-Delete mit Undo, wie bei echten Logs in Heute.
  function removePlanned(l: LogEntry) {
    void deleteLog(l.id)
    showUndo(t('plan.removed'), () => restoreLog(l.id))
  }

  // Frisch geplante Mahlzeit aus dem Picker — Undo löscht den planned-Log wieder.
  function handlePlanned(entry: LogEntry, food: FoodItem) {
    showUndo(t('plan.plannedFor', { name: food.name }), () => deleteLog(entry.id))
  }

  // Fehlende Zutaten auf die Einkaufsliste; Undo nimmt genau diese wieder runter.
  async function addMissingToList(date: string) {
    const created = await missingToShoppingList(date)
    if (created.length === 0) return
    showUndo(t('plan.addedToList', { count: created.length }), async () => {
      await Promise.all(created.map((i) => removeShoppingItem(i.id)))
    })
  }

  // Wochen-Summe: Ø kcal über Tage mit Einträgen, Anzahl Einträge, Kosten.
  const daysWithLogs = kcalByDay.filter((_, i) => byDay[i].length > 0)
  const avgKcal = daysWithLogs.length
    ? Math.round(daysWithLogs.reduce((a, b) => a + b, 0) / daysWithLogs.length)
    : 0
  const weekCost = sumCost(logs)
  // Wochenbudget aus den Settings gegen die Kosten der angezeigten Woche.
  const budget = budgetProgress(weekCost, settings.weeklyBudget)

  return (
    <div className="flex flex-col">
      <PageHeader title={t('week.title')} subtitle={range}>
        <ProfileAvatar />
        <button
          type="button"
          onClick={() => setWeekOffset((w) => w - 1)}
          aria-label={t('week.prevWeek')}
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          type="button"
          onClick={() => setWeekOffset((w) => w + 1)}
          aria-label={t('week.nextWeek')}
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card"
        >
          <ChevronRight size={20} />
        </button>
      </PageHeader>

      {/* Tag-Strip: Mini-kcal-Fortschritt je Tag, Tap springt zum Panel. */}
      <div className="scrollbar-none -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {days.map((d, i) => {
          const active = i === activeIdx
          const pct = Math.min(1, kcalByDay[i] / kcalGoal)
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => jumpTo(i)}
              aria-label={t('week.dayLabel', { day: fmtDay.format(d.date) })}
              aria-current={active ? 'date' : undefined}
              className={cn(
                'focus-ring flex w-12 shrink-0 flex-col items-center gap-1 rounded-md border py-2',
                active ? 'border-primary bg-primary-soft' : 'border-border bg-card',
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-semibold',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {fmtWeekdayShort.format(d.date).replace(/\.$/, '')}
              </span>
              <span className={cn('text-sm font-bold', active && 'text-primary')}>
                {d.date.getDate()}
              </span>
              <span className="block h-1 w-5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${pct * 100}%` }}
                />
              </span>
            </button>
          )
        })}
      </div>

      {/* Wischbare Tages-Panels (Scroll-Snap, ein Panel = volle Breite). */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory overflow-x-auto"
      >
        {days.map((d, i) => {
          const dayLogs = byDay[i]
          const kcal = kcalByDay[i]
          const isToday = d.key === today
          const isFuture = d.key > today
          // Plan-UI gibt es nur für Zukunfts-Tage — heute/vergangen zeigen nur echte Logs.
          const dayPlanned = isFuture ? plannedByDay[i] : []
          const plannedKcal = dayPlanned.reduce((a, l) => a + l.computed.kcal, 0)
          const plannedCost = sumPlannedCost(dayPlanned)
          const missing = isFuture ? missingByDay.get(d.key) ?? [] : []
          return (
            <section
              key={d.key}
              aria-label={fmtDay.format(d.date)}
              className="w-full shrink-0 snap-start space-y-3 px-4 pb-4"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-bold">
                  {fmtWeekdayLong.format(d.date)}, {fmtDay.format(d.date)}
                  {isToday && (
                    <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                      {t('week.todayChip')}
                    </span>
                  )}
                </h2>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {dayLogs.length ? `${Math.round(kcal)} kcal` : t('week.noKcal')}
                  {dayPlanned.length > 0 && (
                    <>
                      {' · '}
                      <span className="italic opacity-80">
                        {t('week.plannedKcal', { kcal: Math.round(plannedKcal) })}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-brand-gradient"
                  initial={false}
                  animate={{ width: `${Math.min(1, kcal / kcalGoal) * 100}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>

              {dayLogs.length === 0 && dayPlanned.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 p-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <CalendarPlus size={26} />
                  </span>
                  <div>
                    <p className="font-semibold">{t('week.emptyTitle')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {/* Vergangene Tage lassen sich nicht mehr vorausplanen. */}
                      {isFuture || isToday ? t('week.emptyBody') : t('week.emptyPast')}
                    </p>
                  </div>
                  {isFuture && (
                    <Button onClick={() => setPlanFor(d.key)}>{t('week.planFromPantry')}</Button>
                  )}
                  {isToday && <Button onClick={openCapture}>{t('week.logNow')}</Button>}
                </Card>
              ) : (
                <>
                  {MEALS.map((meal) => {
                    const items = dayLogs.filter((l) => l.meal === meal)
                    const plannedItems = dayPlanned.filter((l) => l.meal === meal)
                    const showEmptyCta = isToday && items.length === 0 && meal !== 'snack'
                    if (items.length === 0 && plannedItems.length === 0 && !showEmptyCta) return null
                    return (
                      <div key={meal} className="space-y-2">
                        <h3 className="text-sm font-semibold text-muted-foreground">
                          {t(`today.meals.${meal}`)}
                        </h3>
                        {items.map((l) => (
                          <WeekLogRow
                            key={l.id}
                            log={l}
                            name={foods.get(l.foodId)?.name ?? '—'}
                            photoUrl={l.photoBlobId ? photos?.get(l.photoBlobId) : undefined}
                          />
                        ))}
                        {plannedItems.map((l) => (
                          <PlannedRow
                            key={l.id}
                            log={l}
                            name={foods.get(l.foodId)?.name ?? '—'}
                            onConfirm={() => void confirmEntry(l)}
                            onRemove={() => removePlanned(l)}
                          />
                        ))}
                        {showEmptyCta && (
                          // Heute noch offen: direkter Log-Einstieg (Quick-Sheet).
                          <button
                            type="button"
                            onClick={openCapture}
                            className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input text-sm font-medium text-muted-foreground"
                          >
                            <Plus size={16} /> {t('week.nothingLogged')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {isFuture && (
                    // Weitere Mahlzeit für diesen Tag vorplanen.
                    <button
                      type="button"
                      onClick={() => setPlanFor(d.key)}
                      className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input text-sm font-medium text-muted-foreground"
                    >
                      <Plus size={16} /> {t('week.planFromPantry')}
                    </button>
                  )}
                  {dayPlanned.length > 0 && (
                    // Panel-Fußzeile: Kosten-Snapshot des Plans + fehlende Zutaten.
                    <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                      {plannedCost > 0 && (
                        <p className="text-xs italic tabular-nums text-muted-foreground">
                          {t('week.plannedCost', { cost: formatEuro(plannedCost) })}
                        </p>
                      )}
                      {missing.length > 0 && (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-warning-text">
                            {t('plan.missingCount', { count: missing.length })}
                          </p>
                          <Button
                            variant="secondary"
                            className="shrink-0"
                            onClick={() => void addMissingToList(d.key)}
                          >
                            {t('plan.toShoppingList')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </div>

      {/* Wochen-Summe — Kosten färben sich, wenn das Wochenbudget überschritten ist. */}
      <Card className="space-y-2 px-6 py-3">
        <div className="flex justify-between">
          <div className="text-center">
            <div className="font-mono text-lg font-bold tabular-nums">{avgKcal}</div>
            <div className="text-xs text-muted-foreground">{t('week.avgKcal')}</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg font-bold tabular-nums">{logs.length}</div>
            <div className="text-xs text-muted-foreground">{t('week.mealsCount')}</div>
          </div>
          <div className="text-center">
            <div className={cn('font-mono text-lg font-bold tabular-nums', budget?.over && 'text-warning-text')}>
              {formatEuro(weekCost)}
            </div>
            <div className="text-xs text-muted-foreground">{t('week.cost')}</div>
          </div>
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
              {t('budget.spentOfBudget', {
                spent: formatEuro(weekCost),
                budget: formatEuro(settings.weeklyBudget!),
              })}
              {' · '}
              <span className={cn(budget.over && 'font-medium text-warning-text')}>
                {t(budget.over ? 'budget.over' : 'budget.left', { amount: formatEuro(budget.diff) })}
              </span>
            </p>
          </div>
        )}
      </Card>

      {/* Vorrats-Picker fürs Vorplanen (Bottom-Sheet, Muster PortionSheet). */}
      <PlanSheet date={planFor} onClose={() => setPlanFor(null)} onPlanned={handlePlanned} />
    </div>
  )
}

/**
 * Geplanter (noch nicht gegessener) Eintrag: bewusst dezent — gestrichelte
 * Border, „geplant"-Chip, kcal kursiv/gedimmt. „Gegessen ✓" bestätigt,
 * der Papierkorb entfernt die Planung (beides mit Undo im Aufrufer).
 */
function PlannedRow({
  log,
  name,
  onConfirm,
  onRemove,
}: {
  log: LogEntry
  name: string
  onConfirm: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-input bg-card/60 p-2.5">
      <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
        {t('plan.plannedBadge')}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
        {name}
      </span>
      <span className="shrink-0 text-xs italic tabular-nums text-muted-foreground opacity-80">
        {Math.round(log.computed.kcal)}
      </span>
      <button
        type="button"
        onClick={onConfirm}
        aria-label={t('plan.confirmAria', { name })}
        className="focus-ring flex h-11 shrink-0 items-center gap-1 rounded-full bg-primary-soft px-3 text-xs font-semibold text-primary"
      >
        <Check size={14} strokeWidth={3} aria-hidden="true" /> {t('plan.confirm')}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('plan.removeAria', { name })}
        className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Bottom-Sheet „Aus Vorrat planen" (Muster PortionSheet): Mahlzeit wählen,
 * dann ein Vorrats-Lebensmittel antippen → planFood für den Tag mit der
 * üblichen Portion (Undo-Toast übernimmt der Aufrufer via onPlanned).
 */
function PlanSheet({
  date,
  onClose,
  onPlanned,
}: {
  date: string | null
  onClose: () => void
  onPlanned: (entry: LogEntry, food: FoodItem) => void
}) {
  const { t } = useTranslation()
  return (
    <AnimatePresence>
      {date && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-lg"
            role="dialog"
            aria-label={t('plan.planMeal')}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <PlanForm key={date} date={date} onClose={onClose} onPlanned={onPlanned} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function PlanForm({
  date,
  onClose,
  onPlanned,
}: {
  date: string
  onClose: () => void
  onPlanned: (entry: LogEntry, food: FoodItem) => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [meal, setMeal] = useState<Meal>('lunch')
  const [saving, setSaving] = useState(false)
  const pantry = useLiveQuery(() => pantryFoods(), [])
  const fmtDate = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  // Ein Tipp plant die übliche Portion (defaultPortion, sonst 100 g/ml).
  async function pick(food: FoodItem) {
    if (saving) return
    setSaving(true)
    try {
      const dp = food.defaultPortion
      const entry = await planFood({
        food,
        date,
        meal,
        amount: dp?.amount ?? 100,
        unit: dp?.unit ?? food.per,
      })
      onPlanned(entry, food)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('plan.planMeal')}</h2>
        <p className="text-sm text-muted-foreground">
          {fmtDate.format(new Date(`${date}T12:00:00`))}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('today.edit.meal')}>
        {MEALS.map((m) => (
          <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
        ))}
      </div>

      {pantry === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : pantry.length === 0 ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm text-muted-foreground">{t('plan.pickerEmpty')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              onClose()
              navigate('/pantry')
            }}
          >
            {t('nav.pantry')}
          </Button>
        </div>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {pantry.map((f) => {
            const dp = f.defaultPortion
            const kcal = computeLogValues(f, dp?.amount ?? 100, dp?.unit ?? f.per).kcal
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => void pick(f)}
                  disabled={saving}
                  aria-label={t('plan.pickFood', { name: f.name })}
                  className="focus-ring flex min-h-[48px] w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {dp ? describePortion(dp, t('today.edit.unitPortion')) : `100 ${f.per}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {Math.round(kcal)} kcal
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Button variant="ghost" className="w-full border border-input" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}

function WeekLogRow({ log, name, photoUrl }: { log: LogEntry; name: string; photoUrl?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded-md bg-muted" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {Math.round(log.computed.kcal)}
      </span>
    </div>
  )
}
