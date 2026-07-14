import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Pencil, Plus } from 'lucide-react'
import type { FoodItem, LogEntry, Meal, Unit } from '@/db/types'
import { computeCost, getSettings, logFood, setFoodPrice, updateSettings } from '@/db/repo'
import { addFoodServing, getFoodPhotos } from '@/lib/foodEdit'
import { analyzeImage } from '@/lib/ai'
import { toApiError } from '@/lib/apiError'
import { downscaleImage } from '@/lib/image'
import { gramsFromPortionResult, portionPhotoHint } from '@/lib/portion'
import { parsePositiveNumber, formatEuro } from '@/lib/money'
import { MEALS } from '@/lib/meal'
import { todayKey } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { FoodDetailSheet } from '@/components/FoodDetailSheet'

interface Props {
  food: FoodItem | null
  /** Vorauswahl der Mahlzeit (aus der Erfassen-Seite). */
  initialMeal: Meal
  onClose: () => void
  /** Nach erfolgreichem Log (Undo-Toast übernimmt der Aufrufer). */
  onLogged: (entry: LogEntry, food: FoodItem) => void
}

/**
 * Bottom-Sheet für den Verzehr aus dem Vorrat: Menge + Einheit (g/ml/Portion/
 * benannte Einheiten wie „Kappe (30 g)") + Mahlzeit → loggen. Neue Einheiten
 * lassen sich direkt hier anlegen („+ Einheit", mit Presets wie Esslöffel),
 * die Menge per Foto schätzen (KI-Modus 'portion') und der Packungspreis
 * (Haushaltskasse) nachpflegen — strikt optional.
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
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88vh] max-w-md overflow-y-auto rounded-t-3xl bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-lg"
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

/** Ausgewählte Eingabe-Einheit: Log-Einheit (g/ml/Portion) oder benannte Portionseinheit. */
type UnitSel = { kind: 'unit'; unit: Unit } | { kind: 'serving'; idx: number }

/**
 * Schnellvorschläge fürs Anlegen benannter Einheiten (Nutzerfeedback:
 * „Kappe"/Messlöffel, Esslöffel). `grams: null` = Stück ohne Vorgabe —
 * der Gramm-Wert kommt von Hand oder per Foto-Schätzung.
 */
const UNIT_PRESETS = [
  { key: 'tbsp', grams: 15 },
  { key: 'tsp', grams: 5 },
  { key: 'cap', grams: 30 },
  { key: 'slice', grams: 25 },
  { key: 'piece', grams: null },
] as const

/** Menge im deutschen Format („0,5") für Chip-Beschriftungen. */
const fmtAmount = (n: number) => String(n).replace('.', ',')

function PortionForm({ food: initialFood, initialMeal, onClose, onLogged }: Props & { food: FoodItem }) {
  const { t } = useTranslation()
  // Lokale Produkt-Kopie: der Editor (FoodDetailSheet) kann Name/Portion/Preis
  // ändern — onSaved zieht diese Kopie nach, damit das Sheet nichts Veraltetes
  // zurückschreibt (z. B. den alten Packungspreis beim Loggen).
  const [food, setFood] = useState(initialFood)
  const dp = food.defaultPortion
  const [amountText, setAmountText] = useState(String(dp?.amount ?? 100))
  const [sel, setSel] = useState<UnitSel>({ kind: 'unit', unit: dp?.unit ?? food.per })
  const [meal, setMeal] = useState<Meal>(initialMeal)
  // Haushaltskasse (optional): Packungspreis in EUR + Packungsgröße in g/ml.
  const [priceText, setPriceText] = useState(food.price ? String(food.price.amount).replace('.', ',') : '')
  const [packText, setPackText] = useState(food.price ? String(food.price.per) : '')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  // „+ Einheit": Inline-Formular für eine neue benannte Einheit (Kappe, EL …).
  const [unitFormOpen, setUnitFormOpen] = useState(false)
  const [unitLabel, setUnitLabel] = useState('')
  const [unitAmount, setUnitAmount] = useState('')
  const [unitSaving, setUnitSaving] = useState(false)

  // „Menge per Foto": KI-Schätzung (Analyse-Modus 'portion', wie im Editor).
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoHint, setPhotoHint] = useState<string | null>(null)
  const [photoErrorKey, setPhotoErrorKey] = useState<string | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const amountCamRef = useRef<HTMLInputElement>(null)
  const unitCamRef = useRef<HTMLInputElement>(null)
  // Einmalige Einwilligung, Fotos an den KI-Dienst zu senden (wie Capture/Editor).
  const photoConsent = useLiveQuery(async () => (await getSettings()).photoConsent ?? false, [])
  // Produktfotos (Nährwerttabelle, Packung …) — Tap öffnet den Editor mit Galerie.
  const photos = useLiveQuery(() => getFoodPhotos(food.id), [food.id]) ?? []

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount > 0

  // Benannte Portionseinheiten („Stück", „Kappe", „EL") — ein gleichnamiges
  // Label der üblichen Portion nicht doppelt anbieten.
  const servings = (food.servings ?? []).filter(
    (s) => !dp?.label || s.label.toLowerCase() !== dp.label.toLowerCase(),
  )
  // Log-Einheiten: konkrete Basis (g/ml) + 'portion', wenn eine übliche Portion bekannt ist.
  const units: Unit[] = dp ? [food.per, 'portion'] : [food.per]
  const unitLabelOf = (u: Unit) => (u === 'portion' ? dp?.label ?? t('today.edit.unitPortion') : u)

  // Gerechnet wird IMMER in der Basis-Menge; die benannte Einheit ist nur
  // Eingabe-Hilfe + Anzeige-Snapshot („2 Stück") auf dem Log.
  const activeServing = sel.kind === 'serving' ? servings[sel.idx] : undefined
  const baseAmount = activeServing ? amount * activeServing.amount : amount
  const baseUnit: Unit = activeServing ? food.per : sel.kind === 'unit' ? sel.unit : food.per
  const servingSnap = activeServing && valid ? { label: activeServing.label, count: amount } : undefined

  function selectUnit(u: Unit) {
    setSel({ kind: 'unit', unit: u })
    // Beim Wechsel auf „Portion" ist 1 die sinnvolle Menge, zurück die gemerkte.
    setAmountText(u === 'portion' ? '1' : String(dp?.amount ?? 100))
  }
  function selectServing(idx: number) {
    setSel({ kind: 'serving', idx })
    setAmountText('1')
  }

  /** Kamera öffnen — ohne erteilte Foto-Einwilligung erst den Consent-Block zeigen. */
  function requestPhoto(ref: React.RefObject<HTMLInputElement | null>) {
    if (photoConsent !== true) {
      setConsentOpen(true)
      return
    }
    setConsentOpen(false)
    ref.current?.click()
  }

  /**
   * Gemeinsamer Foto-Schätz-Lauf (Muster FoodDetailSheet.onPortionPhotoFile):
   * downscale → analyzeImage('portion', …, Hint = Produktname + Einheit) →
   * Gramm oder null (Fehler landen in photoErrorKey, errors.*-Mechanik).
   */
  async function runPortionEstimate(file: File, unitContext?: string): Promise<number | null> {
    setPhotoBusy(true)
    setPhotoErrorKey(null)
    setPhotoHint(null)
    try {
      const dataUrl = await downscaleImage(file)
      const result = await analyzeImage('portion', dataUrl, portionPhotoHint(food.name, unitContext))
      const grams = gramsFromPortionResult(result)
      if (grams == null) {
        setPhotoErrorKey('food.edit.portionEstimateNone')
        return null
      }
      return grams
    } catch (err) {
      setPhotoErrorKey(toApiError(err).i18nKey)
      return null
    } finally {
      setPhotoBusy(false)
    }
  }

  /** „Menge per Foto": Schätzung füllt das Mengen-Feld, Einheit springt auf die Basis (g/ml). */
  async function onAmountPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || photoBusy) return
    const grams = await runPortionEstimate(file, activeServing?.label)
    if (grams == null) return
    setSel({ kind: 'unit', unit: food.per })
    setAmountText(String(grams))
    setPhotoHint(t('add.amountPhotoDone', { amount: grams, unit: food.per }))
  }

  /** Foto-Button im „+ Einheit"-Formular: füllt den Gramm-Wert der NEUEN Einheit. */
  async function onUnitPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || photoBusy) return
    const grams = await runPortionEstimate(file, unitLabel.trim() || undefined)
    if (grams == null) return
    setUnitAmount(String(grams))
    setPhotoHint(t('add.amountPhotoDone', { amount: grams, unit: food.per }))
  }

  /** Neue Einheit speichern (foodEdit, additiv) und sofort als Auswahl aktivieren. */
  async function saveUnit() {
    const label = unitLabel.trim()
    const grams = parsePositiveNumber(unitAmount)
    if (!label || grams == null || unitSaving) return
    setUnitSaving(true)
    try {
      const updated = await addFoodServing(food.id, { label, amount: grams })
      setFood(updated)
      // Neue Einheit direkt anwählen — Index in der GEFILTERTEN Chip-Liste suchen.
      const list = (updated.servings ?? []).filter(
        (s) => !dp?.label || s.label.toLowerCase() !== dp.label.toLowerCase(),
      )
      const idx = list.findIndex((s) => s.label.toLowerCase() === label.toLowerCase())
      if (idx >= 0) {
        setSel({ kind: 'serving', idx })
        setAmountText('1')
      }
      setUnitFormOpen(false)
      setUnitLabel('')
      setUnitAmount('')
      setPhotoHint(null)
    } finally {
      setUnitSaving(false)
    }
  }

  // Preis-Eingabe: beide Felder gültig → Preis setzen; beide leer → Preis entfernen;
  // sonst unverändert lassen (kein Datenverlust durch Tippfehler).
  const priceVal = parsePositiveNumber(priceText)
  const packVal = parsePositiveNumber(packText)
  const bothEmpty = !priceText.trim() && !packText.trim()
  const nextPrice = priceVal != null && packVal != null ? { amount: priceVal, per: packVal } : undefined
  const effectivePrice = nextPrice ?? (bothEmpty ? undefined : food.price)
  const cost = valid ? computeCost({ ...food, price: effectivePrice }, baseAmount, baseUnit) : undefined

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
        amount: baseAmount,
        unit: baseUnit,
        serving: servingSnap,
      })
      onLogged(entry, food)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const unitChipCls = (selected: boolean) =>
    `focus-ring min-h-[48px] rounded-xl border px-4 text-sm font-medium transition-colors ${
      selected
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-input bg-background text-foreground'
    }`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{food.name}</h2>
        {/* Einstieg Produkt-Editor (Paket B): Nährwerte, Portion, Preis, Fotos */}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="focus-ring flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-primary"
        >
          <Pencil size={16} aria-hidden="true" /> {t('food.edit.open')}
        </button>
      </div>

      {/* Produktfotos (Nährwerttabelle + Packung, gesammelt u. a. aus Scans):
          kompakte Thumbnail-Reihe, Tap öffnet den Editor mit voller Galerie. */}
      {photos.length > 0 && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('add.photosOpen', { count: photos.length })}
          className="focus-ring flex min-h-[48px] items-center gap-2 rounded-xl"
        >
          {photos.slice(0, 3).map((p) => (
            <img key={p.id} src={p.dataUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
          ))}
          {photos.length > 3 && (
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
              {t('add.photosMore', { count: photos.length - 3 })}
            </span>
          )}
        </button>
      )}

      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
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
          </div>
          {/* „Menge per Foto": KI schätzt die Menge — Ergebnis bleibt anpassbar. */}
          <button
            type="button"
            onClick={() => requestPhoto(amountCamRef)}
            disabled={photoBusy}
            aria-label={t('add.amountPhoto')}
            className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-input text-muted-foreground disabled:opacity-50"
          >
            {photoBusy ? <Spinner size={18} /> : <Camera size={18} aria-hidden="true" />}
          </button>
        </div>

        {/* Einheiten-Chips: g/ml, übliche Portion, ALLE benannten Einheiten mit
            Umrechnung („Kappe (30 g)") + „+ Einheit" zum Anlegen im Moment. */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('today.edit.unit')}>
          {units.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => selectUnit(u)}
              aria-pressed={sel.kind === 'unit' && sel.unit === u}
              className={unitChipCls(sel.kind === 'unit' && sel.unit === u)}
            >
              {unitLabelOf(u)}
            </button>
          ))}
          {servings.map((s, idx) => (
            <button
              key={s.label}
              type="button"
              onClick={() => selectServing(idx)}
              aria-pressed={sel.kind === 'serving' && sel.idx === idx}
              className={unitChipCls(sel.kind === 'serving' && sel.idx === idx)}
            >
              {s.label} ({fmtAmount(s.amount)} {food.per})
            </button>
          ))}
          <button
            type="button"
            onClick={() => setUnitFormOpen((o) => !o)}
            aria-expanded={unitFormOpen}
            className="focus-ring flex min-h-[48px] items-center gap-1 rounded-xl border border-dashed border-input px-4 text-sm font-medium text-muted-foreground"
          >
            <Plus size={14} aria-hidden="true" /> {t('add.unitAdd')}
          </button>
        </div>

        {/* Inline-Formular „+ Einheit": Presets antippen oder frei eingeben;
            der Kamera-Button füllt den Gramm-Wert per KI-Schätzung. */}
        {unitFormOpen && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('add.unitAddTitle')}</p>
            <div className="flex flex-wrap gap-1.5">
              {UNIT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setUnitLabel(t(`add.unitPresets.${p.key}`))
                    setUnitAmount(p.grams != null ? String(p.grams) : '')
                  }}
                  className="focus-ring min-h-[40px] rounded-full border border-input bg-background px-3 text-xs font-medium"
                >
                  {t(`add.unitPresets.${p.key}`)}
                  {p.grams != null ? ` · ${p.grams} g` : ''}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Field label={t('food.edit.servingLabel')}>
                <Input
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                  placeholder={t('food.edit.servingLabelPh')}
                />
              </Field>
              <Field label={t('food.edit.servingAmount', { unit: food.per })}>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={unitAmount}
                  onChange={(e) => setUnitAmount(e.target.value)}
                  placeholder="30"
                />
              </Field>
              <button
                type="button"
                onClick={() => requestPhoto(unitCamRef)}
                disabled={photoBusy}
                aria-label={t('add.unitPhoto')}
                className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-input text-muted-foreground disabled:opacity-50"
              >
                {photoBusy ? <Spinner size={18} /> : <Camera size={18} aria-hidden="true" />}
              </button>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void saveUnit()}
              disabled={!unitLabel.trim() || parsePositiveNumber(unitAmount) == null || unitSaving}
            >
              {t('add.unitSave')}
            </Button>
          </div>
        )}

        {/* Einmalige Foto-Einwilligung (Muster Capture/Editor) — erscheint erst,
            wenn ein Kamera-Button ohne erteilte Einwilligung angetippt wurde. */}
        {consentOpen && photoConsent === false && (
          <div className="space-y-2 rounded-md bg-muted p-3">
            <p className="text-xs font-medium">{t('capture.consentTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('capture.consentBody')}</p>
            <Button variant="secondary" className="w-full" onClick={() => void updateSettings({ photoConsent: true })}>
              {t('capture.consentAccept')}
            </Button>
          </div>
        )}
        {photoHint && (
          <p className="text-xs font-medium text-primary" role="status">
            {photoHint}
          </p>
        )}
        {photoErrorKey && <p className="text-xs text-destructive">{t(photoErrorKey)}</p>}

        {activeServing && (
          <div className="flex items-center gap-2">
            {/* Schnellmengen + Live-Umrechnung in die Basis-Einheit */}
            {['0,5', '1', '2'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmountText(q)}
                className="focus-ring min-h-[40px] rounded-full border border-input bg-background px-3 text-xs font-medium"
              >
                {q}×
              </button>
            ))}
            {valid && (
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                = {Math.round(baseAmount * 10) / 10} {food.per}
              </span>
            )}
          </div>
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

      {/* Verdeckte Kamera-/Galerie-Inputs für die Foto-Schätzungen. Ohne
          `capture`-Attribut darf der Nutzer auch aus der Galerie wählen. */}
      <input ref={amountCamRef} type="file" accept="image/*" hidden onChange={(e) => void onAmountPhotoFile(e)} />
      <input ref={unitCamRef} type="file" accept="image/*" hidden onChange={(e) => void onUnitPhotoFile(e)} />

      {/* Produkt-Editor über dem PortionSheet; onSaved zieht die lokale Kopie
          + die Preisfelder nach, damit save() den neuen Stand nicht zurückdreht. */}
      <FoodDetailSheet
        food={editing ? food : null}
        onClose={() => setEditing(false)}
        onSaved={(updated) => {
          setFood(updated)
          setPriceText(updated.price ? String(updated.price.amount).replace('.', ',') : '')
          setPackText(updated.price ? String(updated.price.per) : '')
        }}
      />
    </div>
  )
}
