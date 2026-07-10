import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { History, Plus, Trash2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { db } from '@/db'
import { addMeasurement, deleteMeasurement, getSettings } from '@/db/repo'
import { useOverlays } from '@/lib/overlays-context'
import type { Measurement } from '@/db/types'
import {
  GROUP_ORDER,
  METRICS,
  clampValue,
  daysBetween,
  groupEnabled,
  latestValue,
  METRIC_BY_KEY,
  type MetricDef,
} from '@/lib/measurements'
import { todayKey } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'
import { TrendChart, type ChartSeries } from '@/components/TrendChart'
import { NutritionHistory } from '@/components/NutritionHistory'
import { BudgetTrends } from '@/components/BudgetTrends'
import { Skeleton } from '@/components/ui/Skeleton'

const RANGES = [
  { key: '4w', days: 28 },
  { key: '3m', days: 90 },
  { key: '1y', days: 365 },
  { key: 'all', days: Infinity },
] as const

const PRIMARY = 'hsl(var(--primary))'
// Zweitlinie (Diastole) über Design-Token statt Ad-hoc-Hex — theme- und darkmode-fähig.
const ACCENT = 'hsl(var(--warning))'

export function Trends() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => getSettings(), [])
  const all = useLiveQuery(() => db.measurements.filter((m) => !m.deletedAt).toArray(), [])
  const [rangeDays, setRangeDays] = useState<number>(90)

  // Skeleton statt Blank, solange Dexie lädt (Muster wie Today).
  if (!settings || !all) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('trends.title')} />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Skeleton key={r.key} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }
  const today = todayKey()
  const byType: Record<string, Measurement[]> = {}
  for (const m of all) (byType[m.type] ??= []).push(m)
  const inRange = (pts: Measurement[]) =>
    pts
      .filter((p) => daysBetween(p.date, today) >= 0 && daysBetween(p.date, today) <= rangeDays)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.loggedAt - b.loggedAt))

  const groups = GROUP_ORDER.filter((g) => groupEnabled(g, settings))

  return (
    <div className="space-y-6">
      <PageHeader title={t('trends.title')} />
      <p className="text-sm text-muted-foreground">{t('trends.intro')}</p>

      {/* Ernährungs-Verlauf (§7.5): kcal-Historie, Makro-Woche, Wochen-Insights */}
      <NutritionHistory />

      {/* Haushaltskasse: € pro Tag, Kategorien, Preis-Leistung (nur mit Preisdaten) */}
      <BudgetTrends />

      <h2 className="text-sm font-semibold text-muted-foreground">{t('trends.measurementsTitle')}</h2>

      {/* Globaler Zeitraum (für die Messwerte darunter) */}
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Chip key={r.key} label={t(`trends.range.${r.key}`)} selected={rangeDays === r.days} onClick={() => setRangeDays(r.days)} />
        ))}
      </div>

      {groups.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{t(`trends.groups.${group}`)}</h2>
          <div className="space-y-3">
            {group === 'vitals' ? (
              <>
                <BloodPressureCard sys={inRange(byType.systolic ?? [])} dia={inRange(byType.diastolic ?? [])} today={today} />
                <MetricRow def={METRIC_BY_KEY.restingPulse} series={inRange(byType.restingPulse ?? [])} today={today} />
              </>
            ) : (
              METRICS.filter((m) => m.group === group).map((def) => (
                <MetricRow key={def.key} def={def} series={inRange(byType[def.key] ?? [])} today={today} />
              ))
            )}
          </div>
        </section>
      ))}

      <p className="text-[11px] text-muted-foreground">{t('trends.disclaimer')}</p>
    </div>
  )
}

/** Statistik aus einer (bereits gefilterten, sortierten) Reihe. */
function stats(series: Measurement[]) {
  if (series.length === 0) return null
  const first = series[0]
  const last = series[series.length - 1]
  const days = Math.max(1, daysBetween(first.date, last.date))
  return { first: first.value, last: last.value, delta: last.value - first.value, ratePerWeek: ((last.value - first.value) / days) * 7 }
}

function MetricRow({ def, series, today }: { def: MetricDef; series: Measurement[]; today: string }) {
  const { t } = useTranslation()
  const { showUndo } = useOverlays()
  const [value, setValue] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const latest = latestValue(series)
  const st = stats(series)
  const fmt = (n: number) => n.toFixed(def.decimals)
  // Letzte ~10 Werte, neueste zuerst — löschbar pro Zeile (Audit-Befund 10).
  const recent = series.slice(-10).reverse()

  async function add() {
    const v = Number(value.replace(',', '.'))
    if (value === '' || Number.isNaN(v)) return
    await addMeasurement(def.key, clampValue(def, v), def.unit, today)
    setValue('')
  }

  // Soft-Delete + Undo statt sofortigem Löschen; Restore entfernt den
  // deletedAt-Tombstone (Dexie löscht Props, die auf undefined gesetzt werden).
  async function remove(m: Measurement) {
    await deleteMeasurement(m.id)
    showUndo(t('trends.deleted'), async () => {
      await db.measurements.update(m.id, { deletedAt: undefined, updatedAt: Date.now() })
    })
  }

  const chartSeries: ChartSeries[] = [{ points: series.map((m) => ({ date: m.date, value: m.value })), color: PRIMARY, label: def.key }]

  return (
    <Card className="space-y-3 p-4">
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
        {st && series.length >= 2 && (
          <TrendChip
            label={def.key === 'weight' && Math.abs(st.ratePerWeek) >= 0.05 ? `${st.ratePerWeek > 0 ? '+' : ''}${st.ratePerWeek.toFixed(1)} ${def.unit}/${t('trends.week')}` : `${st.delta > 0 ? '+' : ''}${fmt(st.delta)} ${def.unit}`}
            dir={st.delta > 0 ? 'up' : st.delta < 0 ? 'down' : 'flat'}
          />
        )}
      </div>

      {series.length >= 2 ? (
        <>
          <TrendChart series={chartSeries} decimals={def.decimals} />
          <StatsRow st={st!} unit={def.unit} decimals={def.decimals} showRate={def.key === 'weight'} />
        </>
      ) : (
        series.length === 1 && <p className="text-xs text-muted-foreground">{t('trends.tooFew')}</p>
      )}

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
        {series.length > 0 && (
          <button
            onClick={() => setShowHistory((s) => !s)}
            aria-label={t('trends.history')}
            aria-expanded={showHistory}
            className={`flex h-12 w-10 items-center justify-center ${showHistory ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <History size={18} />
          </button>
        )}
      </div>

      {/* Aufklappbare Liste der letzten Werte — einzelne Einträge löschen mit Undo. */}
      {showHistory && recent.length > 0 && (
        <ul className="space-y-1" aria-label={t('trends.history')}>
          {recent.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg bg-muted/40 pl-3 text-sm">
              <span className="tabular-nums">
                {fmt(m.value)} {def.unit}
                <span className="ml-2 text-xs text-muted-foreground">{m.date}</span>
              </span>
              <button
                onClick={() => remove(m)}
                aria-label={t('trends.deleteValue', { date: m.date, value: `${fmt(m.value)} ${def.unit}` })}
                className="flex h-12 w-12 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Kombinierte Blutdruck-Karte: systolisch + diastolisch in einem Diagramm. */
function BloodPressureCard({ sys, dia, today }: { sys: Measurement[]; dia: Measurement[]; today: string }) {
  const { t } = useTranslation()
  const [s, setS] = useState('')
  const [d, setD] = useState('')
  const sysLatest = latestValue(sys)
  const diaLatest = latestValue(dia)

  async function add() {
    const sv = Number(s.replace(',', '.'))
    const dv = Number(d.replace(',', '.'))
    const tasks: Promise<unknown>[] = []
    if (s !== '' && !Number.isNaN(sv)) tasks.push(addMeasurement('systolic', clampValue(METRIC_BY_KEY.systolic, sv), 'mmHg', today))
    if (d !== '' && !Number.isNaN(dv)) tasks.push(addMeasurement('diastolic', clampValue(METRIC_BY_KEY.diastolic, dv), 'mmHg', today))
    if (tasks.length === 0) return
    await Promise.all(tasks)
    setS('')
    setD('')
  }

  const chartSeries: ChartSeries[] = []
  if (sys.length >= 2) chartSeries.push({ points: sys.map((m) => ({ date: m.date, value: m.value })), color: PRIMARY, label: 'systolic' })
  if (dia.length >= 2) chartSeries.push({ points: dia.map((m) => ({ date: m.date, value: m.value })), color: ACCENT, label: 'diastolic' })

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{t('trends.bloodPressure')}</p>
        {(sysLatest || diaLatest) && (
          <p className="text-sm">
            <span className="font-semibold tabular-nums">
              {sysLatest ? Math.round(sysLatest.value) : '–'}/{diaLatest ? Math.round(diaLatest.value) : '–'}
            </span>{' '}
            <span className="text-xs text-muted-foreground">mmHg</span>
          </p>
        )}
      </div>

      {chartSeries.length > 0 ? (
        <>
          <TrendChart series={chartSeries} decimals={0} />
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: PRIMARY }} /> {t('trends.metrics.systolic')}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: ACCENT }} /> {t('trends.metrics.diastolic')}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('trends.noData')}</p>
      )}

      <div className="flex items-center gap-2">
        <Input type="number" inputMode="numeric" value={s} onChange={(e) => setS(e.target.value)} placeholder={t('trends.metrics.systolic')} className="flex-1" />
        <span className="text-muted-foreground">/</span>
        <Input type="number" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} placeholder={t('trends.metrics.diastolic')} className="flex-1" />
        <Button className="px-4" onClick={add} disabled={s === '' && d === ''} aria-label={t('trends.add')}>
          <Plus size={18} />
        </Button>
      </div>
    </Card>
  )
}

function StatsRow({ st, unit, decimals, showRate }: { st: NonNullable<ReturnType<typeof stats>>; unit: string; decimals: number; showRate: boolean }) {
  const { t } = useTranslation()
  const fmt = (n: number) => n.toFixed(decimals)
  const cells = [
    { l: t('trends.start'), v: `${fmt(st.first)} ${unit}` },
    { l: t('trends.current'), v: `${fmt(st.last)} ${unit}` },
    { l: t('trends.change'), v: `${st.delta > 0 ? '+' : ''}${fmt(st.delta)} ${unit}` },
  ]
  if (showRate) cells.push({ l: t('trends.rate'), v: `${st.ratePerWeek > 0 ? '+' : ''}${st.ratePerWeek.toFixed(1)} ${unit}/${t('trends.week')}` })
  return (
    <div className="grid gap-2 rounded-xl bg-muted/40 p-2 text-center" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0,1fr))` }}>
      {cells.map((c, i) => (
        <div key={i}>
          <span className="block text-[10px] uppercase text-muted-foreground">{c.l}</span>
          <span className="text-sm font-semibold tabular-nums">{c.v}</span>
        </div>
      ))}
    </div>
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
