import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { db } from '@/db'
import { addMeasurement, deleteMeasurement, getSettings } from '@/db/repo'
import type { Measurement } from '@/db/types'
import {
  GROUP_ORDER,
  METRICS,
  clampValue,
  groupEnabled,
  latestValue,
  trend,
  type MetricDef,
} from '@/lib/measurements'
import { todayKey } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Sparkline } from '@/components/Sparkline'

export function Trends() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => getSettings(), [])
  const all = useLiveQuery(() => db.measurements.filter((m) => !m.deletedAt).toArray(), [])

  if (!settings || !all) return null
  const today = todayKey()
  const byType: Record<string, Measurement[]> = {}
  for (const m of all) (byType[m.type] ??= []).push(m)
  for (const k of Object.keys(byType)) byType[k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.loggedAt - b.loggedAt))

  const groups = GROUP_ORDER.filter((g) => groupEnabled(g, settings))

  return (
    <div className="space-y-6">
      <PageHeader title={t('trends.title')} />
      <p className="text-sm text-muted-foreground">{t('trends.intro')}</p>

      {groups.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{t(`trends.groups.${group}`)}</h2>
          <div className="space-y-3">
            {METRICS.filter((m) => m.group === group).map((def) => (
              <MetricRow key={def.key} def={def} series={byType[def.key] ?? []} today={today} />
            ))}
          </div>
        </section>
      ))}

      <p className="text-[11px] text-muted-foreground">{t('trends.disclaimer')}</p>
    </div>
  )
}

function MetricRow({ def, series, today }: { def: MetricDef; series: Measurement[]; today: string }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const latest = latestValue(series)
  const tr = trend(series, today)
  const showRate = def.key === 'weight' && tr && Math.abs(tr.ratePerWeek) >= 0.05

  async function add() {
    const v = Number(value.replace(',', '.'))
    if (!v && v !== 0) return
    await addMeasurement(def.key, clampValue(def, v), def.unit, today)
    setValue('')
  }

  const fmt = (n: number) => n.toFixed(def.decimals)

  return (
    <Card className="space-y-2.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{t(`trends.metrics.${def.key}`, { defaultValue: def.key })}</p>
          {latest ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{fmt(latest.value)}</span> {def.unit}
              <span className="ml-1 text-xs">· {latest.date}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('trends.noData')}</p>
          )}
        </div>
        {tr && series.length >= 2 && (
          <TrendChip
            label={showRate ? `${tr.ratePerWeek > 0 ? '+' : ''}${tr.ratePerWeek.toFixed(1)} ${def.unit}/${t('trends.week')}` : `${tr.delta > 0 ? '+' : ''}${fmt(tr.delta)} ${def.unit}`}
            dir={tr.delta > 0 ? 'up' : tr.delta < 0 ? 'down' : 'flat'}
          />
        )}
      </div>

      {series.length >= 2 && <Sparkline values={series.map((m) => m.value)} />}

      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('trends.valuePh', { unit: def.unit })}
          className="flex-1"
        />
        <Button className="px-4" onClick={add} disabled={value === ''} aria-label={t('trends.add')}>
          <Plus size={18} />
        </Button>
        {latest && (
          <button
            onClick={() => deleteMeasurement(latest.id)}
            aria-label={t('common.delete')}
            className="flex h-12 w-10 items-center justify-center text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
    </Card>
  )
}

function TrendChip({ label, dir }: { label: string; dir: 'up' | 'down' | 'flat' }) {
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground">
      <Icon size={13} /> {label}
    </span>
  )
}
