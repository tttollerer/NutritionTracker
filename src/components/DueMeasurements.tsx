import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { LineChart, X } from 'lucide-react'
import { db } from '@/db'
import { getSettings, lastMeasurementDates } from '@/db/repo'
import { dueMetrics } from '@/lib/measurements'
import { todayKey } from '@/lib/utils'
import { Card } from '@/components/ui/Card'

/** Dezente Erinnerung auf „Heute", wenn Verlaufswerte fällig sind (kein Push). */
export function DueMeasurements() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => getSettings(), [])
  const lastDates = useLiveQuery(() => lastMeasurementDates(), [])
  // Reaktiv auf neue Messwerte: triggert ein Neu-Auswerten von lastDates.
  useLiveQuery(() => db.measurements.count(), [])
  const [dismissed, setDismissed] = useState(false)

  if (!settings || !lastDates || dismissed) return null
  const due = dueMetrics(settings, lastDates, todayKey())
  if (due.length === 0) return null

  return (
    <Card className="flex items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4">
      <Link to="/trends" className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <LineChart size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t('trends.dueTitle')}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {due.map((m) => t(`trends.metrics.${m.key}`, { defaultValue: m.key })).join(' · ')}
          </span>
        </span>
      </Link>
      <button
        onClick={() => setDismissed(true)}
        aria-label={t('common.cancel')}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <X size={16} />
      </button>
    </Card>
  )
}
