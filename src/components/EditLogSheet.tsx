import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import type { FoodItem, LogEntry, Meal, Unit } from '@/db/types'
import { updateLog } from '@/db/repo'
import { MEALS } from '@/lib/meal'
import { amountForUnitSwitch } from '@/lib/reviewStore'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Input'

interface Props {
  entry: LogEntry | null
  food?: FoodItem
  onClose: () => void
}

/**
 * Bottom-Sheet zum Bearbeiten eines Log-Eintrags (Menge, Einheit, Mahlzeit).
 * Gleiches Sheet-/Motion-Muster wie CaptureSheet; Formular-State wird über
 * key={entry.id} pro Eintrag frisch initialisiert.
 */
export function EditLogSheet({ entry, food, onClose }: Props) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {entry && (
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
            aria-label={t('today.edit.title')}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <EditForm key={entry.id} entry={entry} food={food} onClose={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/** Ausgewählte Eingabe-Einheit: Log-Einheit (g/ml/Portion) oder benannte Portionseinheit. */
type UnitSel = { kind: 'unit'; unit: Unit } | { kind: 'serving'; idx: number }

function EditForm({ entry, food, onClose }: { entry: LogEntry; food?: FoodItem; onClose: () => void }) {
  const { t } = useTranslation()
  // Benannte Portionseinheiten des Produkts („Stück", „Dose", „Cup" …).
  const servings = food?.servings ?? []
  // Wurde der Eintrag in einer benannten Einheit erfasst („2 Stück"), startet
  // der Editor genau dort — Korrektur „ganze Packung → 2 Stück" in 3 Taps.
  const initialServingIdx = entry.serving
    ? servings.findIndex((s) => s.label.toLowerCase() === entry.serving!.label.toLowerCase())
    : -1
  const [sel, setSel] = useState<UnitSel>(
    initialServingIdx >= 0 ? { kind: 'serving', idx: initialServingIdx } : { kind: 'unit', unit: entry.unit },
  )
  const [amountText, setAmountText] = useState(
    String(initialServingIdx >= 0 ? entry.serving!.count : entry.amount),
  )
  const [meal, setMeal] = useState<Meal>(entry.meal)
  const [saving, setSaving] = useState(false)

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount > 0

  // Konkrete Einheit des Lebensmittels (g/ml) + 'portion', wenn eine übliche
  // Portion bekannt ist oder der Eintrag bereits in Portionen erfasst wurde.
  const foodBase: Unit = food?.per ?? (entry.unit === 'portion' ? 'g' : entry.unit)
  const units: Unit[] =
    food?.defaultPortion || entry.unit === 'portion' ? [foodBase, 'portion'] : [foodBase]

  const unitLabel = (u: Unit) => (u === 'portion' ? t('today.edit.unitPortion') : u)

  // Gerechnet wird IMMER in der Basis-Menge; die benannte Einheit ist nur
  // Eingabe-Hilfe + Anzeige-Snapshot („2 Stück") auf dem Log.
  const activeServing = sel.kind === 'serving' ? servings[sel.idx] : undefined
  const baseAmount = activeServing ? amount * activeServing.amount : amount
  const baseUnit: Unit = activeServing ? foodBase : sel.kind === 'unit' ? sel.unit : foodBase

  // Beim Einheitenwechsel die Menge plausibel halten (Audit-Befund 9):
  // "1 Portion" → g wird 100 g statt 1 g; "150 g" → Portion wird 1 Portion.
  // Gleiche Heuristik wie im Prüf-Screen (reviewStore.amountForUnitSwitch).
  function switchUnit(u: Unit) {
    if (sel.kind === 'unit' && sel.unit === u) return
    setSel({ kind: 'unit', unit: u })
    if (sel.kind === 'serving') setAmountText(u === 'portion' ? '1' : String(amountForUnitSwitch(1, u)))
    else if (valid) setAmountText(String(amountForUnitSwitch(amount, u)))
  }
  function switchServing(idx: number) {
    setSel({ kind: 'serving', idx })
    setAmountText('1')
  }

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      await updateLog(entry.id, {
        amount: baseAmount,
        unit: baseUnit,
        meal,
        serving: activeServing ? { label: activeServing.label, count: amount } : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        {food?.name ?? t('today.edit.title')}
      </h2>

      <div className="flex items-end gap-2">
        <Field label={t('today.edit.amount')}>
          <Input
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-label={t('today.edit.amount')}
            aria-invalid={!valid}
          />
        </Field>
        {units.length === 1 && servings.length === 0 && (
          <span className="flex min-h-[48px] shrink-0 items-center px-2 text-sm text-muted-foreground">
            {unitLabel(units[0])}
          </span>
        )}
      </div>

      {(units.length > 1 || servings.length > 0) && (
        // Einheiten-Chips: g/ml, Portion und benannte Einheiten des Produkts.
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('today.edit.unit')}>
          {units.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              aria-pressed={sel.kind === 'unit' && sel.unit === u}
              className={`focus-ring min-h-[48px] rounded-xl border px-4 text-sm font-medium transition-colors ${
                sel.kind === 'unit' && sel.unit === u
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground'
              }`}
            >
              {unitLabel(u)}
            </button>
          ))}
          {servings.map((s, idx) => (
            <button
              key={s.label}
              type="button"
              onClick={() => switchServing(idx)}
              aria-pressed={sel.kind === 'serving' && sel.idx === idx}
              className={`focus-ring min-h-[48px] rounded-xl border px-4 text-sm font-medium transition-colors ${
                sel.kind === 'serving' && sel.idx === idx
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {activeServing && valid && (
        <p className="text-xs tabular-nums text-muted-foreground">
          = {Math.round(baseAmount * 10) / 10} {foodBase}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-muted-foreground">{t('today.edit.meal')}</p>
        <div className="flex flex-wrap gap-2">
          {MEALS.map((m) => (
            <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button className="flex-1" onClick={save} disabled={!valid || saving}>
          {t('today.edit.save')}
        </Button>
      </div>
    </div>
  )
}
