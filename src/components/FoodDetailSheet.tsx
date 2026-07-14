import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Check, ChevronDown, ChevronRight, Image as ImageIcon, Plus, ShoppingBasket, Sparkles, Star, Trash2, X } from 'lucide-react'
import type { FoodItem } from '@/db/types'
import { addFoodPhoto, getFoodPhotos, removeFoodPhoto, updateFoodValues, type FoodValuesPatch } from '@/lib/foodEdit'
import { createFood, getActiveGoalsMap, getAllergies, getSettings, toggleFavorite, updateSettings } from '@/db/repo'
import { incrementPantry, removeFromPantry, restorePantry, setExpiry } from '@/lib/pantryStock'
import { checkAllergens } from '@/lib/allergens'
import { analyzeImage, estimateNutrients } from '@/lib/ai'
import { toApiError } from '@/lib/apiError'
import { downscaleImage } from '@/lib/image'
import { NUTRIENTS } from '@/lib/nutrients'
import { formatEuro, parsePositiveNumber } from '@/lib/money'
import { useOverlays } from '@/lib/overlays-context'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ExpiryBadge } from '@/components/ExpiryBadge'

/**
 * Vorbefüllung fürs Anlegen eines NEUEN Produkts (Draft-Modus): Scan-/KI-Flows
 * und die Erfassen-Seite reichen hier ihre erkannten Werte + Fotos herein.
 */
export interface ProductDraft {
  name?: string
  per?: 'g' | 'ml'
  kcal?: number
  protein?: number
  carbs?: number
  fat?: number
  micros?: Record<string, number>
  /** Bereits aufgenommene Fotos (Data-URLs) — werden beim Anlegen zur Galerie. */
  photos?: string[]
  source?: FoodItem['source']
  barcode?: string
}

/** Ziel beim Anlegen: in den Vorrat legen oder direkt weiter zum Loggen. */
export type ProductCreateAction = 'pantry' | 'log'

interface Props {
  /** null → Sheet geschlossen (Muster PortionSheet). */
  food: FoodItem | null
  onClose: () => void
  /** Nach erfolgreichem Speichern — Aufrufer kann eigene Anzeige nachziehen. */
  onSaved?: (food: FoodItem) => void
  /** Draft-Modus: neues Produkt anlegen (Galerie/Felder identisch zum Editor). */
  draft?: ProductDraft | null
  /** Nach dem Anlegen — 'log' heißt: Aufrufer öffnet sein Mengen-Sheet. */
  onCreated?: (food: FoodItem, action: ProductCreateAction) => void
}

/** Deutsche Dezimal-Eingabe → nicht-negative Zahl; ungültig/leer → null. */
function parseNonNegative(text: string): number | null {
  if (!text.trim()) return null
  const n = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Draft → Pseudo-FoodItem (id '' = Draft-Marker) für das gemeinsame Formular. */
function draftFood(d: ProductDraft): FoodItem {
  return {
    id: '',
    name: d.name ?? '',
    source: d.source ?? 'manual',
    barcode: d.barcode,
    per: d.per ?? 'g',
    kcal: d.kcal ?? 0,
    protein: d.protein ?? 0,
    carbs: d.carbs ?? 0,
    fat: d.fat ?? 0,
    micros: d.micros,
    createdAt: 0,
    updatedAt: 0,
  }
}

/**
 * DAS gemeinsame Produkt-Sheet der App: bearbeitet bestehende Produkte UND legt
 * neue an (Draft-Modus) — mit Foto-Galerie (mehrere Bilder), Name, Nährwerten
 * je 100 g/ml (+ Mikros), Tags, Beschreibung, Portionseinheiten, üblicher
 * Portion, Packungspreis und MHD. Anlegen endet wahlweise im Vorrat oder im
 * Mengen-Sheet („direkt verzehren"). Bottom-Sheet-Muster wie PortionSheet;
 * liegt eine Ebene ÜBER dem PortionSheet (z-60/70), aus dem es geöffnet wird.
 */
export function FoodDetailSheet({ food, onClose, onSaved, draft, onCreated }: Props) {
  const { t } = useTranslation()
  const subject = food ?? (draft ? draftFood(draft) : null)

  return (
    <AnimatePresence>
      {subject && (
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
            aria-label={subject.id ? t('food.edit.title') : t('food.create.title')}
          >
            <div className="mx-auto mb-1 mt-3 h-1 w-10 shrink-0 rounded-full bg-muted" />
            <div className="overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
              <FoodDetailForm
                key={subject.id || 'draft'}
                food={subject}
                initialPhotos={draft?.photos}
                onClose={onClose}
                onSaved={onSaved}
                onCreated={onCreated}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/** Alias fürs durchgängige Konzept: EIN Produkt-Sheet für Anlegen & Bearbeiten. */
export const ProductSheet = FoodDetailSheet

const MACROS = ['kcal', 'protein', 'carbs', 'fat'] as const

function FoodDetailForm({
  food,
  initialPhotos,
  onClose,
  onSaved,
  onCreated,
}: {
  food: FoodItem
  initialPhotos?: string[]
  onClose: () => void
  onSaved?: (food: FoodItem) => void
  onCreated?: (food: FoodItem, action: ProductCreateAction) => void
}) {
  const { t } = useTranslation()
  // Undo-Snackbar fürs Entfernen aus dem Vorrat (Muster Add/Pantry-Seite).
  const { showUndo } = useOverlays()
  // Draft-Modus: id '' = Produkt existiert noch nicht (siehe draftFood).
  const isDraft = !food.id

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
  // MHD der offenen Packung ('YYYY-MM-DD' vom date-Input, leer = keins).
  const [expiryText, setExpiryText] = useState(food.expiryDate ?? '')
  // Beschreibung & Tags (Design 1d) — gespeichert wie Name/Portion/Preis.
  const [description, setDescription] = useState(food.description ?? '')
  const [tags, setTags] = useState<string[]>(food.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  // Benannte Portionseinheiten („Stück" = 22 g) — Chips im Mengen-/Log-Editor.
  const [servingsList, setServingsList] = useState<{ label: string; amount: number }[]>(
    food.servings ?? [],
  )
  const [servingLabel, setServingLabel] = useState('')
  const [servingAmount, setServingAmount] = useState('')
  // „Portion fotografieren": KI schätzt die Menge (Capture-Modus 'portion').
  const [portionBusy, setPortionBusy] = useState(false)
  const [portionHint, setPortionHint] = useState<string | null>(null)
  const [portionError, setPortionError] = useState<string | null>(null)
  // „Nährwerte per KI schätzen" (v1.5): reine Text-Schätzung aus dem Namen.
  const [estimateBusy, setEstimateBusy] = useState(false)
  const [estimateHint, setEstimateHint] = useState<string | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [favorite, setFavorite] = useState(!!food.favorite)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const portionCamRef = useRef<HTMLInputElement>(null)
  // Einmalige Einwilligung, Fotos an den KI-Dienst zu senden (wie Capture/Coach).
  const photoConsent = useLiveQuery(async () => (await getSettings()).photoConsent ?? false, [])
  // Bestehende Produkte: Galerie live aus der DB. Drafts: Fotos lokal sammeln
  // (pendingPhotos) und erst beim Anlegen persistieren — gleiche UI für beides.
  const storedPhotos = useLiveQuery(() => (food.id ? getFoodPhotos(food.id) : Promise.resolve([])), [food.id]) ?? []
  const [pendingPhotos, setPendingPhotos] = useState<string[]>(initialPhotos ?? [])
  // Namensbasierte Allergen-Warnung beim Anlegen (wie früher im Manuell-Formular).
  const allergies = useLiveQuery(() => getAllergies(), []) ?? []
  const [allergyAck, setAllergyAck] = useState(false)
  const allergyHits = isDraft ? checkAllergens({ name }, allergies).contains : []

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

  const valid =
    name.trim().length > 0 &&
    macrosValid &&
    portionValid &&
    priceValid &&
    microsValid &&
    (allergyHits.length === 0 || allergyAck)

  function collectPatch(): FoodValuesPatch {
    const micros: Record<string, number> = {}
    for (const n of NUTRIENTS) {
      const v = parseNonNegative(microText[n.key])
      if (v != null) micros[n.key] = v
    }
    return {
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
      servings: servingsList,
    }
  }

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      // MHD zuerst schreiben — updateFoodValues liest danach den frischen Stand
      // und liefert ihn (inkl. expiryDate) an onSaved zurück.
      if ((food.expiryDate ?? '') !== expiryText) await setExpiry(food.id, expiryText || null)
      const updated = await updateFoodValues(food.id, collectPatch())
      setSaved(true)
      onSaved?.(updated)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Draft-Modus: Produkt anlegen (Upsert über createFood), gesammelte Fotos in
   * die Galerie schreiben, restliche Felder per Patch nachziehen und je nach
   * Ziel in den Vorrat legen ('pantry') oder ans Mengen-Sheet übergeben ('log').
   */
  async function create(action: ProductCreateAction) {
    if (!valid || saving) return
    setSaving(true)
    try {
      const base = await createFood({
        name: name.trim(),
        per,
        kcal: macros.kcal!,
        protein: macros.protein!,
        carbs: macros.carbs!,
        fat: macros.fat!,
        source: food.source,
        barcode: food.barcode,
        servings: servingsList,
      })
      for (const dataUrl of pendingPhotos) await addFoodPhoto(base.id, dataUrl)
      let created = await updateFoodValues(base.id, collectPatch())
      if (expiryText) {
        await setExpiry(base.id, expiryText)
        created = { ...created, expiryDate: expiryText }
      }
      if (action === 'pantry') {
        await incrementPantry(base.id)
        created = { ...created, pantry: true }
      }
      onCreated?.(created, action)
      onClose()
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
      // Draft: Foto lokal sammeln; bestehendes Produkt: direkt an die Galerie.
      if (isDraft) setPendingPhotos((prev) => [...prev, dataUrl])
      else await addFoodPhoto(food.id, dataUrl)
    } catch {
      // Kein Canvas/kaputtes Bild → Galerie bleibt einfach unverändert.
    } finally {
      setPhotoBusy(false)
    }
  }

  /**
   * Übliche Portion abfotografieren: die KI (Capture-Modus 'portion', Hint =
   * Produktname) schätzt die Menge. Das Ergebnis befüllt die Einheiten-Eingaben
   * (Label „Portion" + Menge) und — falls noch leer — die übliche Portion;
   * das Foto wandert zusätzlich in die Produkt-Galerie.
   */
  async function onPortionPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || portionBusy) return
    setPortionBusy(true)
    setPortionError(null)
    setPortionHint(null)
    try {
      const dataUrl = await downscaleImage(file)
      const result = await analyzeImage('portion', dataUrl, name.trim() || undefined)
      const item = result.items[0]
      const grams = item && item.unit !== 'portion' ? Math.round(item.amount) : 0
      if (!(grams > 0)) {
        setPortionError('food.edit.portionEstimateNone')
        return
      }
      // Foto in die Galerie (Draft lokal, sonst direkt persistieren).
      if (isDraft) setPendingPhotos((prev) => [...prev, dataUrl])
      else await addFoodPhoto(food.id, dataUrl)
      setSaved(false)
      setServingLabel((l) => l.trim() || t('food.edit.portionDefaultLabel'))
      setServingAmount(String(grams))
      if (!portionAmount.trim()) setPortionAmount(String(grams))
      setPortionHint(t('food.edit.portionEstimated', { amount: grams, unit: item.unit }))
    } catch (err) {
      setPortionError(toApiError(err).i18nKey)
    } finally {
      setPortionBusy(false)
    }
  }

  /**
   * Aus dem Vorrat entfernen (Fehlscan/Aufräumen): nimmt nur Flag, Zähler und
   * MHD weg — das Produkt selbst bleibt erhalten (Logs referenzieren es).
   * Sheet schließt sofort; Undo über die Snackbar stellt Vorrats-Status UND
   * vorherige Packungsanzahl wieder her (Snapshot aus removeFromPantry).
   */
  async function removePantryEntry() {
    if (saving) return
    setSaving(true)
    try {
      const snapshot = await removeFromPantry(food.id)
      onClose()
      if (snapshot) {
        showUndo(t('food.edit.pantryRemoved', { name: food.name }), () => restorePantry(food.id, snapshot))
      }
    } finally {
      setSaving(false)
    }
  }

  function addTag() {
    const tag = tagInput.trim()
    if (!tag) return
    setSaved(false)
    setTags((prev) => (prev.some((x) => x.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]))
    setTagInput('')
  }

  /**
   * Nährwerte NUR aus dem Produktnamen schätzen (Vertrag v1.5): füllt die
   * Werte-Felder (Makros + bekannte Mikros), setzt die Basis-Einheit aus der
   * KI-Antwort und — falls leer — die übliche Portion. Alles bleibt editierbar;
   * ohne Bildübertragung ist keine Foto-Einwilligung nötig.
   */
  async function estimateFromName() {
    if (estimateBusy || !name.trim()) return
    setEstimateBusy(true)
    setEstimateError(null)
    setEstimateHint(null)
    try {
      const result = await estimateNutrients(name)
      const item = result.items[0]
      if (!item) {
        setEstimateError('errors.generic')
        return
      }
      setSaved(false)
      if (item.unit === 'g' || item.unit === 'ml') setPer(item.unit)
      setMacroText({
        kcal: String(Math.round(item.per100.kcal)),
        protein: String(item.per100.protein),
        carbs: String(item.per100.carbs),
        fat: String(item.per100.fat),
      })
      // Nur Katalog-Mikros übernehmen; nicht geschätzte Felder leeren, damit
      // keine alten Werte fälschlich als „geschätzt" stehen bleiben.
      setMicroText(
        Object.fromEntries(
          NUTRIENTS.map((n) => [n.key, item.per100.micros?.[n.key] != null ? String(item.per100.micros[n.key]) : '']),
        ),
      )
      if (!portionAmount.trim() && item.unit !== 'portion' && item.amount > 0) {
        setPortionAmount(String(Math.round(item.amount)))
      }
      setEstimateHint(t('food.edit.estimateDone'))
    } catch (err) {
      setEstimateError(toApiError(err).i18nKey)
    } finally {
      setEstimateBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{isDraft ? t('food.create.title') : t('food.edit.title')}</h2>
        {/* Favoriten-Stern (1-Tap-Wiederholung) — erst wenn das Produkt existiert. */}
        {!isDraft && (
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
        )}
      </div>

      {/* Foto-Galerie: horizontal scrollbar, Hinzufügen per Kamera/Galerie.
          Draft: lokale Fotos (werden beim Anlegen persistiert) — gleiche Optik. */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{t('food.edit.photos')}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {storedPhotos.map((p) => (
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
          {pendingPhotos.map((dataUrl, idx) => (
            <div key={idx} className="relative shrink-0">
              <img src={dataUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => setPendingPhotos((prev) => prev.filter((_, i) => i !== idx))}
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

      {/* KI-Auswertung erst, wenn das Produkt existiert (Draft hat noch keine Quelle). */}
      {!isDraft && <AiSummaryCard food={food} open={analysisOpen} onToggle={() => setAnalysisOpen((o) => !o)} />}

      <Field label={t('food.edit.name')}>
        <Input value={name} onChange={(e) => touch(setName)(e.target.value)} aria-invalid={!name.trim()} />
      </Field>

      {/* Namensbasierte Allergen-Warnung beim Anlegen (Muster Manuell-Formular):
          Anlegen erst nach ausdrücklicher Bestätigung. */}
      {allergyHits.length > 0 && (
        <div className="space-y-2">
          <p className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive">
            ⚠️ {t('review.allergyWarn', { list: allergyHits.map((h) => t(`onboarding.allergens.${h}`, { defaultValue: h })).join(', ') })}
          </p>
          <label className="flex items-start gap-2 text-xs text-destructive">
            <input
              type="checkbox"
              checked={allergyAck}
              onChange={(e) => setAllergyAck(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--destructive))]"
            />
            <span>{t('review.allergyAck')}</span>
          </label>
        </div>
      )}

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

        {/* Nährwerte NUR aus dem Namen schätzen (v1.5) — für reine Texterfassung
            („Leberkäse Brötchen"): kein Foto nötig, daher auch keine Einwilligung. */}
        <button
          type="button"
          onClick={() => void estimateFromName()}
          disabled={estimateBusy || !name.trim()}
          className="focus-ring flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm font-medium text-muted-foreground disabled:opacity-50"
        >
          <Sparkles size={16} aria-hidden="true" className="text-primary" />
          {estimateBusy ? t('capture.analyzing') : t('food.edit.estimateCta')}
        </button>
        {estimateHint && (
          <p className="text-xs font-medium text-primary" role="status">
            {estimateHint}
          </p>
        )}
        {estimateError && <p className="text-xs text-destructive">{t(estimateError)}</p>}
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

      {/* Portionseinheiten: benannte Mengen („Stück" = 22 g, „Cup" = 90 g …) —
          erscheinen als Einheiten-Chips beim Loggen/Verzehren/Korrigieren. */}
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('food.edit.servingsTitle')}</p>
        {servingsList.length > 0 && (
          <ul className="space-y-1.5">
            {servingsList.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  1 {s.label}{' '}
                  <span className="tabular-nums text-muted-foreground">
                    = {String(s.amount).replace('.', ',')} {per}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => touch(setServingsList)(servingsList.filter((x) => x.label !== s.label))}
                  aria-label={t('food.edit.removeServing', { label: s.label })}
                  className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Field label={t('food.edit.servingLabel')}>
            <Input
              value={servingLabel}
              onChange={(e) => setServingLabel(e.target.value)}
              placeholder={t('food.edit.servingLabelPh')}
            />
          </Field>
          <Field label={t('food.edit.servingAmount', { unit: per })}>
            <Input
              type="text"
              inputMode="decimal"
              value={servingAmount}
              onChange={(e) => setServingAmount(e.target.value)}
              placeholder="22"
            />
          </Field>
          <button
            type="button"
            onClick={() => {
              const label = servingLabel.trim()
              const amount = parsePositiveNumber(servingAmount)
              if (!label || amount == null) return
              touch(setServingsList)([
                ...servingsList.filter((x) => x.label.toLowerCase() !== label.toLowerCase()),
                { label, amount },
              ])
              setServingLabel('')
              setServingAmount('')
              setPortionHint(null)
            }}
            disabled={!servingLabel.trim() || parsePositiveNumber(servingAmount) == null}
            aria-label={t('food.edit.addServing')}
            className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-input text-muted-foreground disabled:opacity-40"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Übliche Portion einfach abfotografieren — die KI schätzt die Menge
            (Hint = Produktname), das Foto landet zusätzlich in der Galerie. */}
        {photoConsent ? (
          <button
            type="button"
            onClick={() => portionCamRef.current?.click()}
            disabled={portionBusy || !name.trim()}
            className="focus-ring flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm font-medium text-muted-foreground disabled:opacity-50"
          >
            <Camera size={16} aria-hidden="true" />
            {portionBusy ? t('capture.analyzing') : t('food.edit.portionPhoto')}
          </button>
        ) : (
          <div className="space-y-2 rounded-md bg-muted p-3">
            <p className="text-xs font-medium">{t('capture.consentTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('capture.consentBody')}</p>
            <Button variant="secondary" className="w-full" onClick={() => void updateSettings({ photoConsent: true })}>
              {t('capture.consentAccept')}
            </Button>
          </div>
        )}
        {portionHint && (
          <p className="text-xs font-medium text-primary" role="status">
            {portionHint}
          </p>
        )}
        {portionError && <p className="text-xs text-destructive">{t(portionError)}</p>}
        <input
          ref={portionCamRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => void onPortionPhotoFile(e)}
        />
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
        <PriceHistory food={food} />
      </div>

      {/* MHD der offenen Packung + Ablauf-Badge (warning/destructive). */}
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t('food.expiry.label')}</p>
          {expiryText && <ExpiryBadge expiryDate={expiryText} />}
        </div>
        <Input
          type="date"
          value={expiryText}
          onChange={(e) => touch(setExpiryText)(e.target.value)}
          aria-label={t('food.expiry.label')}
        />
      </div>

      {!valid && <p className="text-xs text-destructive">{t('food.edit.invalid')}</p>}
      {saved && (
        <p className="flex items-center gap-1 text-xs font-medium text-primary" role="status">
          <Check size={14} /> {t('food.edit.saved')}
        </p>
      )}

      {isDraft ? (
        // Anlegen: Ziel wählen — Vorrat (Einkauf) oder direkt verzehren (Mengen-Sheet).
        <div className="space-y-2 pt-1">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void create('pantry')}
            disabled={!valid || saving}
          >
            <ShoppingBasket size={18} aria-hidden="true" /> {t('food.create.toPantry')}
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1" onClick={() => void create('log')} disabled={!valid || saving}>
              {t('food.create.andLog')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button className="flex-1" onClick={() => void save()} disabled={!valid || saving}>
              {t('food.edit.save')}
            </Button>
          </div>
          {/* Vorrat aufräumen: dezente destruktive Aktion am Ende — nimmt nur
              den Vorrats-Eintrag weg, das Produkt (und seine Logs) bleiben. */}
          {food.pantry && (
            <button
              type="button"
              onClick={() => void removePantryEntry()}
              disabled={saving}
              aria-label={t('food.edit.pantryRemoveNamed', { name: food.name })}
              className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md text-sm font-medium text-destructive disabled:opacity-50"
            >
              <Trash2 size={16} aria-hidden="true" />
              {t('food.edit.pantryRemove')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Mini-Preis-Historie unter dem Packungspreis: die letzten 5 abgelösten
 * Preise (Datum + Preis, mono) — bewusst nur eine Liste, keine Chart-Library.
 */
function PriceHistory({ food }: { food: FoodItem }) {
  const { t, i18n } = useTranslation()
  const history = (food.priceHistory ?? []).slice(0, 5)
  if (history.length === 0) return null

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' })
  return (
    <div className="space-y-1 border-t border-border/60 pt-2">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{t('food.edit.priceHistory')}</p>
      <ul>
        {history.map((p) => (
          <li key={p.at} className="flex items-baseline justify-between py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            <span>{dateFmt.format(new Date(p.at))}</span>
            <span>
              {formatEuro(p.amount)} / {p.per} {food.per}
            </span>
          </li>
        ))}
      </ul>
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
