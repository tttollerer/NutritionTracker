import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/db'
import {
  addMonths,
  dateFromKey,
  logCountByDay,
  monthGridCells,
  monthRange,
  weekdayLabels,
  yearMonthOfKey,
  type YearMonth,
} from '@/lib/dayContext'
import { todayKey } from '@/lib/utils'

/** Wie weit der Monats-Pager zurückblättern darf (Anforderung: mind. 3 Monate). */
const CALENDAR_MONTHS_BACK = 12

interface Props {
  open: boolean
  /** Aktuell ausgewählter Tag ('YYYY-MM-DD') — wird gefüllt dargestellt. */
  selectedDate: string
  /** Tap auf einen Tag: Aufrufer setzt das Datum und schließt das Sheet. */
  onSelect: (date: string) => void
  onClose: () => void
}

/**
 * Bottom-Sheet mit Monatskalender (Wochenstart Montag): pro Tag ein
 * Status-Punkt (geloggt = Punkt in primary), heutiger Tag umrandet,
 * ausgewählter Tag gefüllt. Gleiches Sheet-/Motion-Muster wie EditLogSheet.
 */
export function CalendarSheet({ open, selectedDate, onSelect, onClose }: Props) {
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
            aria-label={t('today.calendar.title')}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            {/* Frisch pro Öffnen gemountet → Monats-State startet beim gewählten Tag. */}
            <CalendarBody selectedDate={selectedDate} onSelect={onSelect} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function CalendarBody({ selectedDate, onSelect }: Pick<Props, 'selectedDate' | 'onSelect'>) {
  const { t, i18n } = useTranslation()
  const today = todayKey()
  const [ym, setYm] = useState<YearMonth>(() => yearMonthOfKey(selectedDate))

  const currentYm = yearMonthOfKey(today)
  const minYm = addMonths(currentYm, -CALENDAR_MONTHS_BACK)
  const atMax = ym.year === currentYm.year && ym.month === currentYm.month
  const atMin = ym.year === minYm.year && ym.month === minYm.month

  // Datenbasis: einmal pro Monat alle Logs des Zeitraums laden (Index 'date').
  const { start, end } = monthRange(ym)
  const counts = useLiveQuery(
    async () => logCountByDay(await db.logs.where('date').between(start, end, true, true).toArray()),
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
          aria-label={t('today.calendar.prevMonth')}
          className="focus-ring flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-base font-semibold" aria-live="polite">
          {monthTitle}
        </h2>
        <button
          type="button"
          onClick={() => setYm((m) => addMonths(m, 1))}
          disabled={atMax}
          aria-label={t('today.calendar.nextMonth')}
          className="focus-ring flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground" aria-hidden="true">
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
              count={counts?.get(key) ?? 0}
              isToday={key === today}
              isSelected={key === selectedDate}
              isFuture={key > today}
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
  count,
  isToday,
  isSelected,
  isFuture,
  locale,
  onSelect,
}: {
  dayKey: string
  count: number
  isToday: boolean
  isSelected: boolean
  isFuture: boolean
  locale: string
  onSelect: (date: string) => void
}) {
  const { t } = useTranslation()
  const date = dateFromKey(dayKey)
  const label = t('today.calendar.dayLabel', {
    date: date.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
    count,
  })

  return (
    <button
      type="button"
      onClick={() => onSelect(dayKey)}
      disabled={isFuture}
      aria-label={label}
      aria-pressed={isSelected}
      className={`focus-ring mx-auto flex h-11 w-11 flex-col items-center justify-center rounded-full text-sm tabular-nums transition-colors ${
        isSelected
          ? 'bg-primary font-semibold text-primary-foreground'
          : isToday
            ? 'border-2 border-primary font-semibold text-foreground'
            : 'text-foreground'
      } ${isFuture ? 'opacity-30' : ''}`}
    >
      <span>{date.getDate()}</span>
      {/* Status-Punkt: geloggt = primary; Layout bleibt ohne Logs stabil. */}
      <span
        aria-hidden="true"
        className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
          count > 0 ? (isSelected ? 'bg-primary-foreground' : 'bg-primary') : 'bg-transparent'
        }`}
      />
    </button>
  )
}
