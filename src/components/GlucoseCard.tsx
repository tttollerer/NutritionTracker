import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Activity, Trash2 } from 'lucide-react'
import { db } from '@/db'
import { addGlucose, deleteGlucose } from '@/db/repo'
import type { GlucoseContext } from '@/db/types'
import { classifyGlucose, fromMgdl, glucoseWarning, toMgdl, type GlucoseLevel } from '@/lib/glucose'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

const CONTEXTS: GlucoseContext[] = ['fasting', 'before', 'after', 'random']
const LEVEL_COLOR: Record<GlucoseLevel, string> = {
  low: 'text-destructive',
  normal: 'text-success-text',
  elevated: 'text-warning-text',
  high: 'text-destructive',
}

/** Optionales Diabetes-Modul: manuelle Blutzucker-Messwerte + Warner. */
export function GlucoseCard({ unit, date }: { unit: 'mg/dl' | 'mmol/l'; date: string }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [context, setContext] = useState<GlucoseContext>('fasting')

  const readings = useLiveQuery(
    () => db.glucose.where('date').equals(date).filter((g) => !g.deletedAt).toArray(),
    [date],
  )
  const sorted = (readings ?? []).sort((a, b) => b.loggedAt - a.loggedAt)

  async function save() {
    const v = Number(value)
    if (!v || v <= 0) return
    await addGlucose(toMgdl(v, unit), context, undefined, date)
    setValue('')
  }

  const warn = sorted.map((r) => glucoseWarning(r.mgdl, r.context)).find(Boolean)

  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        {/* Activity statt Droplets: Wasser behält das Tropfen-Icon exklusiv. */}
        <Activity size={18} className="text-primary" /> {t('glucose.title')}
      </h2>

      {/* low = akut gefährlich (rot), high = erhöht/beobachten (warnend) — unterscheidbar. */}
      {warn && (
        <p className={cn('rounded-lg px-3 py-2 text-sm', warn === 'low' ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning-text')}>
          {warn === 'low' ? t('glucose.warnLow') : t('glucose.warnHigh')}
        </p>
      )}

      {/* Eingabe */}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('glucose.value', { unit })}
          className="flex-1"
        />
        <Button className="px-4" onClick={save} disabled={!value}>
          {t('glucose.save')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {CONTEXTS.map((c) => (
          <Chip key={c} label={t(`glucose.contexts.${c}`)} selected={context === c} onClick={() => setContext(c)} />
        ))}
      </div>

      {/* Verlauf heute */}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('glucose.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((r) => {
            const level = classifyGlucose(r.mgdl, r.context)
            return (
              <motion.div key={r.id} layout className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span className="flex items-baseline gap-2">
                  <span className={cn('font-semibold tabular-nums', LEVEL_COLOR[level])}>
                    {fromMgdl(r.mgdl, unit)} {unit}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`glucose.contexts.${r.context}`)} · {t(`glucose.levels.${level}`)}
                  </span>
                </span>
                <button onClick={() => deleteGlucose(r.id)} aria-label={t('common.delete')} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={16} />
                </button>
              </motion.div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{t('glucose.disclaimer')}</p>
    </Card>
  )
}
