import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Check, ChevronDown, ChevronRight, Image as ImageIcon, Plus, Sparkles, Star, X } from 'lucide-react'
import type { FoodItem } from '@/db/types'
import { addFoodPhoto, getFoodPhotos, removeFoodPhoto, updateFoodValues, type FoodValuesPatch } from '@/lib/foodEdit'
import { getActiveGoalsMap, toggleFavorite } from '@/db/repo'
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
  // Beschreibung & Tags (Design 1d) — gespeichert wie Name/Portion/Preis.
  const [description, setDescription] = useState(food.description ?? '')
  const [tags, setTags] = useState<string[]>(food.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [favorite, setFavorite] = useState(!!food.favorite)
  const [analysisOpen, setAnalysisOpen] = useState(false)
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
        description,
        tags,
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

  function addTag() {
    const tag = tagInput.trim()
    if (!tag) return
    setSaved(false)
    setTags((prev) => (prev.some((x) => x.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]))
    setTagInput('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('food.edit.title')}</h2>
        {/* Favoriten-Stern (1-Tap-Wiederholung) direkt im Detail. */}
        <button
          type="button"
          onClick={() => void toggleFavorite(food.id).then(setFavorite)}
          aria-pressed={favorite}
          aria-label={t('food.edit.favToggle', { name: food.name })}
          className={`focus-ring flex h-11 w-11 items-center justify-center rounded-md border border-border ${
            favorite ? 'text-warning' : 'text-muted-foreground'
          }`}
        >
          <Star size={20} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

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

      {/* Tags (Kategorie/Frei-Tags) — Filtergrundlage im Einkauf/Vorrat. */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{t('food.edit.tags')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pl-3 pr-1.5 text-xs font-semibold text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => touch(setTags)(tags.filter((x) => x !== tag))}
                aria-label={t('food.edit.removeTag', { tag })}
                className="focus-ring flex h-5 w-5 items-center justify-center rounded-full"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder={t('food.edit.addTagPh')}
            aria-label={t('food.edit.addTag')}
            className="min-h-[32px] w-36 rounded-full border border-dashed border-input bg-transparent px-3 text-xs outline-none ring-ring focus:ring-2"
          />
          <button
            type="button"
            onClick={addTag}
            disabled={!tagInput.trim()}
            aria-label={t('food.edit.addTag')}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-input text-muted-foreground disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Freitext-Beschreibung */}
      <Field label={t('food.edit.description')}>
        <textarea
          value={description}
          onChange={(e) => touch(setDescription)(e.target.value)}
          placeholder={t('food.edit.descriptionPh')}
          rows={3}
          className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-base outline-none ring-ring focus:ring-2"
        />
      </Field>

      <AiSummaryCard food={food} open={analysisOpen} onToggle={() => setAnalysisOpen((o) => !o)} />

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

/** Anzeige-Label der Quelle für das Badge der KI-Auswertung. */
const SOURCE_BADGE: Record<FoodItem['source'], string> = {
  ai: 'food.ai.sourceAi',
  openfoodfacts: 'food.ai.sourceOff',
  usda: 'food.ai.sourceUsda',
  manual: 'food.ai.sourceManual',
}

/**
 * KI-Auswertung (Design 1d): fasst die erfassten Nährwerte fürs Profil
 * zusammen — Protein-Beitrag pro Portion gegen das aktive Tagesziel,
 * Kennzahlen-Kacheln und eine aufklappbare vollständige Nährstoff-Analyse.
 * Bewusst deterministisch aus den gespeicherten Werten berechnet (die KI hat
 * sie beim Scan geliefert); es findet KEIN weiterer API-Call statt.
 */
function AiSummaryCard({ food, open, onToggle }: { food: FoodItem; open: boolean; onToggle: () => void }) {
  const { t, i18n } = useTranslation()
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  // Deutsche Dezimalschreibweise („27,5" statt „27.5") für alle Kennzahlen.
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString(i18n.language)

  // Bezugsgröße: gemerkte übliche Portion, sonst 100 g/ml.
  const portionAmount = food.defaultPortion?.unit !== 'portion' ? (food.defaultPortion?.amount ?? 100) : 100
  const factor = portionAmount / 100
  const portionLabel = `${portionAmount} ${food.per}`
  const proteinPerPortion = food.protein * factor

  const proteinTarget = goals?.protein?.target
  const summary = proteinTarget
    ? t('food.ai.summaryProtein', {
        pct: Math.round((proteinPerPortion / proteinTarget) * 100),
        portion: portionLabel,
      })
    : t('food.ai.summaryNoGoal', { protein: fmt(proteinPerPortion), portion: portionLabel })

  // Erfasste Mikronährstoffe in Katalog-Reihenfolge (inkl. sugar/fiber-Spiegelfelder).
  const microValue = (key: string): number | undefined =>
    food.micros?.[key] ?? (key === 'sugar' ? food.sugar : key === 'fiber' ? food.fiber : undefined)
  const present = NUTRIENTS.flatMap((n) => {
    const value = microValue(n.key)
    return value != null ? [{ ...n, value }] : []
  })

  // Kennzahlen-Kacheln: Protein + die ersten zwei erfassten Mikros, sonst Makros.
  const tiles: { label: string; value: string }[] = [
    { label: t('today.macros.protein'), value: `${fmt(proteinPerPortion)} g` },
    ...present.slice(0, 2).map((n) => ({
      label: t(`nutrients.names.${n.key}`, { defaultValue: n.key }),
      value: `${fmt(n.value * factor)} ${n.unit}`,
    })),
  ]
  while (tiles.length < 3) {
    const k = tiles.length === 2 ? 'fat' : 'carbs'
    tiles.push({
      label: t(`today.macros.${k}`),
      value: `${Math.round(food[k] * factor)} g`,
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/25 bg-primary-soft p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-gradient text-primary-foreground">
          <Sparkles size={18} />
        </span>
        <span className="font-bold">{t('food.ai.title')}</span>
        <span className="ml-auto rounded-full bg-card px-2.5 py-1 text-[11px] font-bold text-primary">
          {t(SOURCE_BADGE[food.source])}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{summary}</p>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-md bg-card/70 px-2 py-2 text-center">
            <div className="font-mono text-sm font-bold tabular-nums">{tile.value}</div>
            <div className="text-[10px] font-semibold text-primary">{tile.label}</div>
          </div>
        ))}
      </div>
      {present.length > 0 ? (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="focus-ring flex min-h-[40px] w-full items-center justify-center gap-1 rounded-md text-sm font-bold text-primary"
          >
            {open ? t('food.ai.hideAnalysis') : t('food.ai.fullAnalysis', { count: present.length })}
            <ChevronRight size={15} className={open ? 'rotate-90' : ''} />
          </button>
          {open && (
            <ul className="divide-y divide-border/60 rounded-md bg-card/70 px-3">
              {present.map((n) => (
                <li key={n.key} className="flex items-baseline justify-between py-2 text-sm">
                  <span>{t(`nutrients.names.${n.key}`, { defaultValue: n.key })}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {fmt(n.value)} {n.unit} / 100 {food.per}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('food.ai.noMicros')}</p>
      )}
    </div>
  )
}
