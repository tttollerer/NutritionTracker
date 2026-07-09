import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Check, ChevronDown, Image as ImageIcon, X } from 'lucide-react'
import type { FoodItem } from '@/db/types'
import { addFoodPhoto, getFoodPhotos, removeFoodPhoto, updateFoodValues, type FoodValuesPatch } from '@/lib/foodEdit'
import { downscaleImage } from '@/lib/image'
import { NUTRIENTS } from '@/lib/nutrients'
import { parsePositiveNumber } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'

interface Props {
  /** null → Sheet geschlossen (Muster PortionSheet). */
  food: FoodItem | null
  onClose: () => void
  /** Nach erfolgreichem Speichern — Aufrufer kann eigene Anzeige nachziehen. */
  onSaved?: (food: FoodItem) => void
}

/** Deutsche Dezimal-Eingabe → nicht-negative Zahl; ungültig/leer → null. */
function parseNonNegative(text: string): number | null {
  if (!text.trim()) return null
  const n = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Produkt-Editor (Paket B): Name, Nährwerte je 100 g/ml (Makros + aufklappbare
 * Mikros aus dem Katalog), übliche Portion (Menge + Label), Packungspreis und
 * eine Foto-Galerie (mehrere Bilder je Produkt, horizontal scrollbar).
 * Bottom-Sheet-Muster wie PortionSheet/EditLogSheet; liegt eine Ebene ÜBER dem
 * PortionSheet (z-60/70), aus dem es geöffnet wird.
 */
export function FoodDetailSheet({ food, onClose, onSaved }: Props) {
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
            className="fixed inset-0 z-[60] bg-black/40"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[88vh] max-w-md flex-col rounded-t-3xl bg-card shadow-lg"
            role="dialog"
            aria-label={t('food.edit.title')}
          >
            <div className="mx-auto mb-1 mt-3 h-1 w-10 shrink-0 rounded-full bg-muted" />
            <div className="overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
              <FoodDetailForm key={food.id} food={food} onClose={onClose} onSaved={onSaved} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

const MACROS = ['kcal', 'protein', 'carbs', 'fat'] as const

function FoodDetailForm({ food, onClose, onSaved }: Props & { food: FoodItem }) {
  const { t } = useTranslation()

  const [name, setName] = useState(food.name)
  const [per, setPer] = useState<'g' | 'ml'>(food.per)
  const [macroText, setMacroText] = useState<Record<(typeof MACROS)[number], string>>({
    kcal: String(food.kcal),
    protein: String(food.protein),
    carbs: String(food.carbs),
    fat: String(food.fat),
  })
  const [microText, setMicroText] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUTRIENTS.map((n) => [n.key, food.micros?.[n.key] != null ? String(food.micros[n.key]) : ''])),
  )
  const [microsOpen, setMicrosOpen] = useState(false)
  // Übliche Portion: Menge in der Basis-Einheit + Anzeige-Label (z. B. „Tasse").
  const dp = food.defaultPortion
  const [portionAmount, setPortionAmount] = useState(dp && dp.unit !== 'portion' ? String(dp.amount) : '')
  const [portionLabel, setPortionLabel] = useState(dp?.label ?? '')
  // Haushaltskasse (optional), gleiche Semantik wie im PortionSheet.
  const [priceText, setPriceText] = useState(food.price ? String(food.price.amount).replace('.', ',') : '')
  const [packText, setPackText] = useState(food.price ? String(food.price.per) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const photos = useLiveQuery(() => getFoodPhotos(food.id), [food.id]) ?? []

  // Jede Eingabe hebt das „Gespeichert"-Feedback wieder auf.
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setSaved(false)
      setter(v)
    }
  }

  const macros = Object.fromEntries(MACROS.map((k) => [k, parseNonNegative(macroText[k])])) as Record<
    (typeof MACROS)[number],
    number | null
  >
  const macrosValid = MACROS.every((k) => macros[k] != null)

  const portionVal = parsePositiveNumber(portionAmount)
  const portionValid = !portionAmount.trim() || portionVal != null

  const priceVal = parsePositiveNumber(priceText)
  const packVal = parsePositiveNumber(packText)
  const priceBothEmpty = !priceText.trim() && !packText.trim()
  const priceValid = priceBothEmpty || (priceVal != null && packVal != null)

  const microsValid = NUTRIENTS.every((n) => !microText[n.key].trim() || parseNonNegative(microText[n.key]) != null)

  const valid = name.trim().length > 0 && macrosValid && portionValid && priceValid && microsValid

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      const micros: Record<string, number> = {}
      for (const n of NUTRIENTS) {
        const v = parseNonNegative(microText[n.key])
        if (v != null) micros[n.key] = v
      }
      const patch: FoodValuesPatch = {
        name: name.trim(),
        per,
        kcal: macros.kcal!,
        protein: macros.protein!,
        carbs: macros.carbs!,
        fat: macros.fat!,
        micros,
        defaultPortion: portionVal
          ? { amount: portionVal, unit: per, label: portionLabel.trim() || undefined }
          : null,
        price: priceVal != null && packVal != null ? { amount: priceVal, per: packVal } : null,
      }
      const updated = await updateFoodValues(food.id, patch)
      setSaved(true)
      onSaved?.(updated)
    } finally {
      setSaving(false)
    }
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || photoBusy) return
    setPhotoBusy(true)
    try {
      const dataUrl = await downscaleImage(file)
      await addFoodPhoto(food.id, dataUrl)
    } catch {
      // Kein Canvas/kaputtes Bild → Galerie bleibt einfach unverändert.
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('food.edit.title')}</h2>

      {/* Foto-Galerie: horizontal scrollbar, Hinzufügen per Kamera/Galerie */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{t('food.edit.photos')}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <div key={p.id} className="relative shrink-0">
              <img src={p.dataUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => void removeFoodPhoto(food.id, p.id)}
                aria-label={t('food.edit.removePhoto')}
                className="focus-ring absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={photoBusy}
            aria-label={t('food.edit.addPhoto')}
            className="focus-ring flex h-20 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input text-muted-foreground disabled:opacity-50"
          >
            <Camera size={20} />
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={photoBusy}
            aria-label={t('food.edit.addFromGallery')}
            className="focus-ring flex h-20 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input text-muted-foreground disabled:opacity-50"
          >
            <ImageIcon size={20} />
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhotoFile(e)} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => void onPhotoFile(e)} />
      </div>

      <Field label={t('food.edit.name')}>
        <Input value={name} onChange={(e) => touch(setName)(e.target.value)} aria-invalid={!name.trim()} />
      </Field>

      {/* Nährwerte je 100 g/ml + Basis-Toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{t('food.edit.values', { unit: per })}</p>
          <div className="flex gap-1 rounded-md bg-muted p-1" role="group" aria-label={t('food.edit.per')}>
            {(['g', 'ml'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={per === u}
                onClick={() => touch(setPer)(u)}
                className={`focus-ring min-h-[40px] rounded-sm px-3 text-sm ${per === u ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {MACROS.map((k) => (
            <label key={k} className="space-y-1">
              <span className="block truncate text-center text-[10px] uppercase text-muted-foreground">
                {k === 'kcal' ? 'kcal' : t(`today.macros.${k}`)}
              </span>
              <Input
                type="text"
                inputMode="decimal"
                value={macroText[k]}
                onChange={(e) => touch((v: string) => setMacroText((m) => ({ ...m, [k]: v })))(e.target.value)}
                aria-invalid={macros[k] == null}
                className="px-1 text-center text-sm"
              />
            </label>
          ))}
        </div>

        {/* Mikronährstoffe: alle Katalog-Keys aus src/lib/nutrients.ts, aufklappbar */}
        <button
          type="button"
          onClick={() => setMicrosOpen((o) => !o)}
          aria-expanded={microsOpen}
          className="focus-ring flex min-h-[40px] items-center gap-1 rounded-md text-xs font-medium text-muted-foreground"
        >
          <ChevronDown size={14} className={microsOpen ? 'rotate-180' : ''} />
          {t('food.edit.micros', { count: NUTRIENTS.length })}
        </button>
        {microsOpen && (
          <div className="grid grid-cols-3 gap-2">
            {NUTRIENTS.map((n) => (
              <label key={n.key} className="space-y-1">
                <span className="block text-center text-[10px] text-muted-foreground">
                  {t(`nutrients.names.${n.key}`, { defaultValue: n.key })} ({n.unit})
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={microText[n.key]}
                  onChange={(e) =>
                    touch((v: string) => setMicroText((m) => ({ ...m, [n.key]: v })))(e.target.value)
                  }
                  aria-invalid={!!microText[n.key].trim() && parseNonNegative(microText[n.key]) == null}
                  className="px-1 text-center text-sm"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Übliche Portion: Menge in Basis-Einheit + Anzeige-Label */}
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('food.edit.portionTitle')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('food.edit.portionAmount', { unit: per })}>
            <Input
              type="text"
              inputMode="decimal"
              value={portionAmount}
              onChange={(e) => touch(setPortionAmount)(e.target.value)}
              aria-invalid={!portionValid}
              placeholder="80"
            />
          </Field>
          <Field label={t('food.edit.portionLabel')}>
            <Input value={portionLabel} onChange={(e) => touch(setPortionLabel)(e.target.value)} placeholder={t('food.edit.portionLabelPh')} />
          </Field>
        </div>
      </div>

      {/* Haushaltskasse: Packungspreis (optional) */}
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('add.pantryPriceTitle')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('add.pantryPrice')}>
            <Input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => touch(setPriceText)(e.target.value)}
              aria-invalid={!priceValid}
              placeholder="2,49"
            />
          </Field>
          <Field label={t('add.pantryPackSize', { unit: per })}>
            <Input
              type="text"
              inputMode="decimal"
              value={packText}
              onChange={(e) => touch(setPackText)(e.target.value)}
              aria-invalid={!priceValid}
              placeholder="500"
            />
          </Field>
        </div>
      </div>

      {!valid && <p className="text-xs text-destructive">{t('food.edit.invalid')}</p>}
      {saved && (
        <p className="flex items-center gap-1 text-xs font-medium text-primary" role="status">
          <Check size={14} /> {t('food.edit.saved')}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button className="flex-1" onClick={() => void save()} disabled={!valid || saving}>
          {t('food.edit.save')}
        </Button>
      </div>
    </div>
  )
}
