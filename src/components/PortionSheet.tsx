import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import type { FoodItem, LogEntry, Meal, Unit } from '@/db/types'
import { computeCost, logFood, setFoodPrice } from '@/db/repo'
import { parsePositiveNumber, formatEuro } from '@/lib/money'
import { MEALS } from '@/lib/meal'
import { todayKey } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Input'

interface Props {
  food: FoodItem | null
  /** Vorauswahl der Mahlzeit (aus der Erfassen-Seite). */
  initialMeal: Meal
  onClose: () => void
  /** Nach erfolgreichem Log (Undo-Toast + Navigation übernimmt der Aufrufer). */
  onLogged: (entry: LogEntry, food: FoodItem) => void
}

/**
 * Bottom-Sheet für den Verzehr aus dem Vorrat: Menge + Einheit (g/ml/Portion
 * mit Label-Anzeige, z. B. „Tasse") + Mahlzeit → loggen. Zusätzlich lässt sich
 * hier der Packungspreis (Haushaltskasse) nachpflegen — strikt optional.
 * Gleiches Sheet-/Motion-Muster wie EditLogSheet.
 */
export function PortionSheet({ food, initialMeal, onClose, onLogged }: Props) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {food && (
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
            aria-label={t('add.pantryAmount', { name: food.name })}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <PortionForm key={food.id} food={food} initialMeal={initialMeal} onClose={onClose} onLogged={onLogged} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function PortionForm({ food, initialMeal, onClose, onLogged }: Props & { food: FoodItem }) {
  const { t } = useTranslation()
  const dp = food.defaultPortion
  const [amountText, setAmountText] = useState(String(dp?.amount ?? 100))
  const [unit, setUnit] = useState<Unit>(dp?.unit ?? food.per)
  const [meal, setMeal] = useState<Meal>(initialMeal)
  // Haushaltskasse (optional): Packungspreis in EUR + Packungsgröße in g/ml.
  const [priceText, setPriceText] = useState(food.price ? String(food.price.amount).replace('.', ',') : '')
  const [packText, setPackText] = useState(food.price ? String(food.price.per) : '')
  const [saving, setSaving] = useState(false)

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount > 0

  // Einheiten: konkrete Basis (g/ml) + 'portion', wenn eine übliche Portion bekannt ist.
  const units: Unit[] = dp ? [food.per, 'portion'] : [food.per]
  const unitLabel = (u: Unit) => (u === 'portion' ? dp?.label ?? t('today.edit.unitPortion') : u)

  // Preis-Eingabe: beide Felder gültig → Preis setzen; beide leer → Preis entfernen;
  // sonst unverändert lassen (kein Datenverlust durch Tippfehler).
  const priceVal = parsePositiveNumber(priceText)
  const packVal = parsePositiveNumber(packText)
  const bothEmpty = !priceText.trim() && !packText.trim()
  const nextPrice = priceVal != null && packVal != null ? { amount: priceVal, per: packVal } : undefined
  const effectivePrice = nextPrice ?? (bothEmpty ? undefined : food.price)
  const cost = valid ? computeCost({ ...food, price: effectivePrice }, amount, unit) : undefined

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      const priceChanged = (nextPrice || bothEmpty) &&
        JSON.stringify(effectivePrice ?? null) !== JSON.stringify(food.price ?? null)
      if (priceChanged) await setFoodPrice(food.id, effectivePrice)
      const entry = await logFood({
        food: { ...food, price: effectivePrice },
        date: todayKey(),
        meal,
        amount,
        unit,
      })
      onLogged(entry, food)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{food.name}</h2>

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
        {units.length > 1 ? (
          <div className="flex shrink-0 gap-1" role="group" aria-label={t('today.edit.unit')}>
            {units.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => {
                  setUnit(u)
                  // Beim Wechsel auf „Portion" ist 1 die sinnvolle Menge, zurück die gemerkte.
                  setAmountText(u === 'portion' ? '1' : String(dp?.amount ?? 100))
                }}
                aria-pressed={unit === u}
                className={`focus-ring min-h-[48px] rounded-xl border px-4 text-sm font-medium transition-colors ${
                  unit === u
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-foreground'
                }`}
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex min-h-[48px] shrink-0 items-center px-2 text-sm text-muted-foreground">
            {unitLabel(unit)}
          </span>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-muted-foreground">{t('today.edit.meal')}</p>
        <div className="flex flex-wrap gap-2">
          {MEALS.map((m) => (
            <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
          ))}
        </div>
      </div>

      {/* Haushaltskasse: Packungspreis nachpflegen — komplett optional. */}
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('add.pantryPriceTitle')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('add.pantryPrice')}>
            <Input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="2,49"
            />
          </Field>
          <Field label={t('add.pantryPackSize', { unit: food.per })}>
            <Input
              type="text"
              inputMode="decimal"
              value={packText}
              onChange={(e) => setPackText(e.target.value)}
              placeholder="500"
            />
          </Field>
        </div>
        {cost != null && (
          <p className="text-xs text-muted-foreground">{t('add.pantryCost', { cost: formatEuro(cost) })}</p>
        )}
      </div>

      <div className="flex gap-3 pt-1">
        <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button className="flex-1" onClick={save} disabled={!valid || saving}>
          {t('add.pantryLog')}
        </Button>
      </div>
    </div>
  )
}
