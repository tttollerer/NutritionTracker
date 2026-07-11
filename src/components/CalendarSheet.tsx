import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/db'
import {
  addMonths,
  CALENDAR_MONTHS_BACK,
  CALENDAR_MONTHS_FORWARD,
  dateFromKey,
  logCountByDay,
  monthGridCells,
  monthIndex,
  monthRange,
  weekdayLabels,
  yearMonthOfKey,
  type DayLogCounts,
  type YearMonth,
} from '@/lib/calendar'
import { cn } from '@/lib/utils'

/**
 * Bottom-Sheet mit Monatskalender (Wochenstart Montag) für die Woche-Seite:
 * Rückblick „was habe ich gegessen" + Absprung zum Nachtragen/Planen.
 * Pro Tag ein Status-Punkt — echte Logs gefüllt in primary, nur geplante als
 * hohler Punkt — der heutige Tag ist umrandet. Tap auf einen Tag schließt das
 * Sheet; der Aufrufer springt zur passenden Woche. Gleiches Sheet-/Motion-
 * Muster wie PlanSheet/EditLogSheet.
 */
export function CalendarSheet({
  open,
  focusDate,
  today,
  onSelect,
  onClose,
}: {
  open: boolean
  /** Tag, auf dem die Woche gerade steht — Startmonat und gefüllte Zelle. */
  focusDate: string
  today: string
  /** Tap auf einen Tag: Aufrufer springt zur Woche und schließt das Sheet. */
  onSelect: (date: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <AnimatePresence>
      {open && (
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
            aria-label={t('calendar.title')}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            {/* Frisch pro Öffnen gemountet → Monats-State startet beim gewählten Tag. */}
            <CalendarBody focusDate={focusDate} today={today} onSelect={onSelect} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function CalendarBody({
  focusDate,
  today,
  onSelect,
}: {
  focusDate: string
  today: string
  onSelect: (date: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [ym, setYm] = useState<YearMonth>(() => yearMonthOfKey(focusDate))

  // Blätter-Fenster relativ zu HEUTE: 12 Monate zurück, 12 vor (Planungshorizont).
  const currentYm = yearMonthOfKey(today)
  const atMin = monthIndex(ym) <= monthIndex(currentYm) - CALENDAR_MONTHS_BACK
  const atMax = monthIndex(ym) >= monthIndex(currentYm) + CALENDAR_MONTHS_FORWARD

  // Datenbasis: einmal pro Monat alle Logs des Zeitraums laden (Index 'date');
  // logCountByDay trennt echte von geplanten und filtert Gelöschte.
  const { start, end } = monthRange(ym)
  const counts = useLiveQuery(
    async () =>
      logCountByDay(await db.logs.where('date').between(start, end, true, true).toArray()),
    [start, end],
  )

  const monthTitle = new Date(ym.year, ym.month, 1).toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYm((m) => addMonths(m, -1))}
          disabled={atMin}
          aria-label={t('calendar.prevMonth')}
          className="focus-ring flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="text-base font-semibold" aria-live="polite">
          {monthTitle}
        </h2>
        <button
          type="button"
          onClick={() => setYm((m) => addMonths(m, 1))}
          disabled={atMax}
          aria-label={t('calendar.nextMonth')}
          className="focus-ring flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      <div
        className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {weekdayLabels(i18n.language).map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {monthGridCells(ym).map((key, i) =>
          key === null ? (
            <span key={`pad-${i}`} aria-hidden="true" />
          ) : (
            <DayCell
              key={key}
              dayKey={key}
              counts={counts?.get(key) ?? { logged: 0, planned: 0 }}
              isToday={key === today}
              isSelected={key === focusDate}
              locale={i18n.language}
              onSelect={onSelect}
            />
          ),
        )}
      </div>
    </div>
  )
}

function DayCell({
  dayKey,
  counts,
  isToday,
  isSelected,
  locale,
  onSelect,
}: {
  dayKey: string
  counts: DayLogCounts
  isToday: boolean
  isSelected: boolean
  locale: string
  onSelect: (date: string) => void
}) {
  const { t } = useTranslation()
  const date = dateFromKey(dayKey)
  // A11y: „3. Juli, 2 Einträge" — geplante werden zusätzlich angesagt.
  let label = t('calendar.dayLabel', {
    date: date.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
    count: counts.logged,
  })
  if (counts.planned > 0) label += t('calendar.dayPlannedSuffix', { count: counts.planned })

  return (
    <button
      type="button"
      onClick={() => onSelect(dayKey)}
      aria-label={label}
      aria-pressed={isSelected}
      className={cn(
        'focus-ring mx-auto flex h-11 w-11 flex-col items-center justify-center rounded-full text-sm tabular-nums transition-colors',
        isSelected
          ? 'bg-primary font-semibold text-primary-foreground'
          : isToday
            ? 'border-2 border-primary font-semibold text-foreground'
            : 'text-foreground',
      )}
    >
      <span>{date.getDate()}</span>
      {/* Status-Punkt: echte Logs gefüllt (primary), nur geplante hohl;
          transparenter Platzhalter hält das Layout ohne Einträge stabil. */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 h-1.5 w-1.5 rounded-full',
          counts.logged > 0
            ? isSelected
              ? 'bg-primary-foreground'
              : 'bg-primary'
            : counts.planned > 0
              ? isSelected
                ? 'border border-primary-foreground'
                : 'border border-primary'
              : 'bg-transparent',
        )}
      />
    </button>
  )
}
