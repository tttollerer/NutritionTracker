import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarPlus, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { db } from '@/db'
import type { FoodItem, LogEntry, Photo } from '@/db/types'
import { getActiveGoalsMap } from '@/db/repo'
import { formatEuro, sumCost } from '@/lib/money'
import { MEALS } from '@/lib/meal'
import { cn, todayKey } from '@/lib/utils'
import { useTodayKey } from '@/hooks/useTodayKey'
import { useOverlays } from '@/lib/overlays-context'
import { PageHeader } from '@/components/PageHeader'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
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
  const navigate = useNavigate()
  const { openCapture } = useOverlays()
  const today = useTodayKey()
  // 0 = aktuelle Woche, -1 = vorherige, … (Chevrons im Header).
  const [weekOffset, setWeekOffset] = useState(0)

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
        .filter((l) => !l.deletedAt)
        .toArray(),
    [firstKey, lastKey],
  )
  const foods = useLiveQuery(async () => {
    if (!logs) return undefined
    const ids = [...new Set(logs.map((l) => l.foodId))]
    const items = await db.foods.bulkGet(ids)
    return new Map(items.filter((f): f is FoodItem => !!f).map((f) => [f.id, f]))
  }, [logs])
  const photos = useLiveQuery(async () => {
    if (!logs) return undefined
    const ids = [...new Set(logs.flatMap((l) => (l.photoBlobId ? [l.photoBlobId] : [])))]
    const items = await db.photos.bulkGet(ids)
    return new Map(items.filter((p): p is Photo => !!p).map((p) => [p.id, p.dataUrl]))
  }, [logs])
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])

  // Fokussierter Tag: heute (aktuelle Woche) bzw. Montag (andere Wochen).
  const todayIdx = days.findIndex((d) => d.key === today)
  const initialIdx = todayIdx >= 0 ? todayIdx : 0
  const [activeIdx, setActiveIdx] = useState(initialIdx)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Solange Daten laden, rendert die Seite nur Skeletons — den Scroll-Container
  // gibt es erst mit `ready`. Der Fokus-Effekt muss daher auf ready reagieren,
  // sonst startet die Woche immer auf Montag statt heute.
  const ready = logs !== undefined && foods !== undefined && goals !== undefined
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

  if (!ready || logs === undefined || foods === undefined || goals === undefined) {
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

  // Wochen-Summe: Ø kcal über Tage mit Einträgen, Anzahl Einträge, Kosten.
  const daysWithLogs = kcalByDay.filter((_, i) => byDay[i].length > 0)
  const avgKcal = daysWithLogs.length
    ? Math.round(daysWithLogs.reduce((a, b) => a + b, 0) / daysWithLogs.length)
    : 0
  const weekCost = sumCost(logs)

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

              {dayLogs.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 p-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <CalendarPlus size={26} />
                  </span>
                  <div>
                    <p className="font-semibold">{t('week.emptyTitle')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t('week.emptyBody')}</p>
                  </div>
                  <Button onClick={() => navigate('/pantry')}>{t('week.planFromPantry')}</Button>
                </Card>
              ) : (
                MEALS.map((meal) => {
                  const items = dayLogs.filter((l) => l.meal === meal)
                  const showEmptyCta = isToday && items.length === 0 && meal !== 'snack'
                  if (items.length === 0 && !showEmptyCta) return null
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
                })
              )}
            </section>
          )
        })}
      </div>

      {/* Wochen-Summe */}
      <Card className="flex justify-between px-6 py-3">
        <div className="text-center">
          <div className="font-mono text-lg font-bold tabular-nums">{avgKcal}</div>
          <div className="text-xs text-muted-foreground">{t('week.avgKcal')}</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-lg font-bold tabular-nums">{logs.length}</div>
          <div className="text-xs text-muted-foreground">{t('week.mealsCount')}</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-lg font-bold tabular-nums">{formatEuro(weekCost)}</div>
          <div className="text-xs text-muted-foreground">{t('week.cost')}</div>
        </div>
      </Card>
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
