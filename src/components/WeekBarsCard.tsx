import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { db } from '@/db'
import type { LogEntry } from '@/db/types'
import { weekDayKeys, weekKcalBars, type WeekBar } from '@/lib/weekBars'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Wochen-Karte: 7 vertikale kcal-Balken (Mo–So) mit gestrichelter Ziellinie.
 * Der Anteil über dem kcal-Ziel färbt sich warning, der heutige Tag ist
 * hervorgehoben. Bewusst ohne Chart-Library — reine Flex-Balken wie die
 * übrigen Fortschrittsanzeigen.
 */

/** Einzelner Balken (von unten wachsend); Über-Ziel-Anteil oben in warning. */
function Bar({ bar, highlight }: { bar: WeekBar; highlight: boolean }) {
  if (bar.kcal === 0) {
    // Leerer Tag: dezenter Stummel, damit die Spalte lesbar bleibt.
    return <span className="h-0.5 w-full rounded-sm bg-muted" />
  }
  return (
    <>
      {bar.overPct > 0 && (
        <span
          className="w-full rounded-t-sm bg-warning"
          style={{ height: `${bar.overPct * 100}%` }}
        />
      )}
      <span
        className={cn('w-full', highlight ? 'bg-primary' : 'bg-primary/50', bar.overPct === 0 && 'rounded-t-sm')}
        // min 3 %: sehr kleine Tage bleiben als Balken (statt Haarlinie) sichtbar.
        style={{ height: `${Math.max(bar.basePct * 100, 3)}%` }}
      />
    </>
  )
}

/**
 * Große Variante für die Woche-Seite — ersetzt die Mini-Striche im Tag-Strip:
 * gleiche Sprungfunktion (Tap → Tages-Panel), aber mit echten kcal-Balken
 * und mono-Zahlen je Tag.
 */
export function WeekBarsCard({
  days,
  logs,
  kcalGoal,
  today,
  activeIdx,
  onSelectDay,
}: {
  days: { key: string; date: Date }[]
  logs: LogEntry[]
  kcalGoal: number
  today: string
  activeIdx: number
  onSelectDay: (idx: number) => void
}) {
  const { t, i18n } = useTranslation()
  const { bars, goalPct } = weekKcalBars(
    logs,
    days.map((d) => d.key),
    kcalGoal,
  )
  const fmtDay = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
  const fmtWeekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
  return (
    <Card className="mb-3 flex gap-1 p-2">
      {days.map((d, i) => {
        const bar = bars[i]
        const isToday = d.key === today
        const active = i === activeIdx
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onSelectDay(i)}
            aria-label={t('week.dayBarLabel', { day: fmtDay.format(d.date), kcal: bar.kcal })}
            aria-current={active ? 'date' : undefined}
            className={cn(
              'focus-ring flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-0.5 py-1.5',
              active && 'bg-primary-soft',
            )}
          >
            <span className="font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
              {bar.kcal > 0 ? bar.kcal : '·'}
            </span>
            <span className="relative flex h-20 w-full items-end justify-center" aria-hidden="true">
              {/* Gestrichelte Ziellinie — je Spalte, ergibt über die Karte eine Linie. */}
              <span
                className="absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
                style={{ bottom: `${goalPct * 100}%` }}
              />
              <span className="flex h-full w-3.5 flex-col justify-end">
                <Bar bar={bar} highlight={isToday} />
              </span>
            </span>
            <span
              className={cn(
                'text-[11px] font-semibold leading-none',
                isToday ? 'text-primary' : active ? 'text-primary/80' : 'text-muted-foreground',
              )}
            >
              {fmtWeekday.format(d.date).replace(/\.$/, '')}
            </span>
            <span className={cn('text-xs font-bold leading-none tabular-nums', isToday && 'text-primary')}>
              {d.date.getDate()}
            </span>
          </button>
        )
      })}
    </Card>
  )
}

/**
 * Mini-Variante für die Heute-Seite (unter der Makro-Karte): kompakte Balken
 * ohne Achsen, die ganze Karte verlinkt auf die Wochen-Ansicht. Lädt die
 * Verzehr-Logs der aktuellen Woche selbst (planned zählt nicht).
 */
export function WeekBarsMini({ today, kcalGoal }: { today: string; kcalGoal: number }) {
  const { t } = useTranslation()
  const dayKeys = useMemo(() => weekDayKeys(today), [today])
  const logs = useLiveQuery(
    () =>
      db.logs
        .where('date')
        .between(dayKeys[0], dayKeys[6], true, true)
        .filter((l) => !l.deletedAt && !l.planned)
        .toArray(),
    [dayKeys],
  )
  if (logs === undefined) return <Skeleton className="h-[4.5rem] w-full" />
  const { bars, goalPct } = weekKcalBars(logs, dayKeys, kcalGoal)
  return (
    <Link to="/week" aria-label={t('week.openWeek')} className="focus-ring block rounded-lg">
      <Card className="flex min-h-[48px] items-center gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('week.miniTitle')}</p>
          <div className="relative flex h-9 items-end gap-1" aria-hidden="true">
            <span
              className="absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
              style={{ bottom: `${goalPct * 100}%` }}
            />
            {bars.map((bar) => (
              <span key={bar.date} className="flex h-full flex-1 flex-col justify-end">
                <Bar bar={bar} highlight={bar.date === today} />
              </span>
            ))}
          </div>
        </div>
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Card>
    </Link>
  )
}
