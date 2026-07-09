import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, ScanText, ScanBarcode, CalendarDays, ImagePlus, X, Star, Search, History, ShoppingBasket, Scale } from 'lucide-react'
import {
  copyYesterday,
  createFood,
  deleteLog,
  favoriteFoods,
  getAllergies,
  logFood,
  pantryFoods,
  quickLogCatalog,
  recentFoods,
  savePhoto,
  searchFoods,
  setLogDate,
  setPantry,
  toggleFavorite,
  yesterdayLogCount,
} from '@/db/repo'
import { checkAllergens } from '@/lib/allergens'
import { useOverlays } from '@/lib/overlays-context'
import type { FoodItem, Meal } from '@/db/types'
import { defaultMeal, MEALS } from '@/lib/meal'
import { FOOD_CATALOG } from '@/lib/foodCatalog'
import { downscaleImage } from '@/lib/image'
import { formatDayLong, getActiveDate, setActiveDate, useActiveDate } from '@/lib/dayContext'
import { useTodayKey } from '@/hooks/useTodayKey'
import { describePortion } from '@/lib/portion'
import { PageHeader } from '@/components/PageHeader'
import { PortionSheet } from '@/components/PortionSheet'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

export function Add() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  // Nachtragen (dayContext): aktives Zieldatum — alle Speicherpfade dieser Seite
  // loggen darauf. In Handlern wird bewusst frisch getActiveDate() gelesen
  // (kein eingefrorener Render-Wert über Mitternacht).
  const today = useTodayKey()
  const activeDate = useActiveDate()
  const backdating = activeDate !== today
  const recents = useLiveQuery(() => recentFoods(), [])
  const favorites = useLiveQuery(() => favoriteFoods(), [])
  const pantry = useLiveQuery(() => pantryFoods(), [])
  // Vorrat-Verzehr über das Mengen-Sheet (Menge + Einheit + Mahlzeit).
  const [portionFood, setPortionFood] = useState<FoodItem | null>(null)
  // „Vortag kopieren" ist relativ zum Zieltag (beim Nachtragen: dessen Vortag).
  const yesterdayCount = useLiveQuery(() => yesterdayLogCount(activeDate), [activeDate]) ?? 0
  // Kontext für „Gestern kopieren" (Befund 11): Zähler der gewählten Mahlzeit.
  const yesterdayMealCount = useLiveQuery(() => yesterdayLogCount(activeDate, meal), [activeDate, meal]) ?? 0
  const allergies = useLiveQuery(() => getAllergies(), []) ?? []
  const [ack, setAck] = useState(false)

  // Katalog-Suche (live über db.foods)
  const [query, setQuery] = useState('')
  const results = useLiveQuery(() => searchFoods(query), [query])

  // Manuelles Formular
  const [name, setName] = useState('')
  const [per, setPer] = useState<'g' | 'ml'>('g')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [amount, setAmount] = useState('100')
  const [photo, setPhoto] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setPhoto(await downscaleImage(file))
  }

  const captureOptions = [
    { icon: Camera, key: 'photo', to: `/capture?mode=meal&meal=${meal}` },
    { icon: ScanText, key: 'label', to: `/capture?mode=label&meal=${meal}` },
    { icon: ScanBarcode, key: 'barcode', to: `/barcode?meal=${meal}` },
  ] as const

  async function logCatalog(id: string) {
    const c = FOOD_CATALOG.find((f) => f.id === id)
    if (!c) return
    const entry = await quickLogCatalog(c, meal, getActiveDate())
    showUndo(t('capture.added', { name: c.name }), () => deleteLog(entry.id))
    navigate('/')
  }

  async function quickLog(food: FoodItem) {
    const entry = await logFood({
      food,
      date: getActiveDate(),
      meal,
      amount: food.defaultPortion?.amount ?? 100,
      unit: food.defaultPortion?.unit ?? (food.per as 'g' | 'ml'),
    })
    showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
    navigate('/')
  }

  /** Menge eines bekannten Lebensmittels per Foto schätzen (mode 'portion'). */
  function portionPhoto(food: FoodItem) {
    navigate(`/capture?mode=portion&meal=${meal}&hint=${encodeURIComponent(food.name)}`)
  }

  /**
   * „Gestern kopieren" respektiert die Mahlzeit-Wahl (Befund 11): standardmäßig
   * wird nur die oben gewählte Mahlzeit kopiert, die Zweitaktion holt den ganzen Tag.
   */
  async function copyFromYesterday(wholeDay = false) {
    // Beim Nachtragen wird der Vortag DES ZIELTAGS auf den Zieltag kopiert.
    const target = getActiveDate()
    const copied = await copyYesterday(wholeDay ? undefined : meal, target)
    if (copied.length === 0) return
    const key = target === today ? 'add.copiedYesterday' : 'add.copiedPrevDay'
    showUndo(t(key, { count: copied.length }), async () => {
      await Promise.all(copied.map((c) => deleteLog(c.id)))
    })
    navigate('/')
  }

  // Namens-basierte Allergen-Warnung für manuell erfasste Lebensmittel.
  const manualHits = checkAllergens({ name }, allergies).contains
  const allergenNames = (keys: string[]) =>
    keys.map((h) => t(`onboarding.allergens.${h}`, { defaultValue: h })).join(', ')

  async function saveManual() {
    if (!name.trim() || !kcal) return
    if (manualHits.length > 0 && !ack) return
    const food = await createFood({
      name,
      per,
      kcal: Number(kcal) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fat: Number(fat) || 0,
    })
    const photoBlobId = photo ? await savePhoto(photo) : undefined
    const entry = await logFood({ food, date: getActiveDate(), meal, amount: Number(amount) || 100, unit: per, photoBlobId })
    showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
    navigate('/')
  }

  // Favoriten stehen in der eigenen Sektion — aus „zuletzt benutzt" ausblenden.
  const recentsWithoutFavs = (recents ?? []).filter((f) => !f.favorite)
  const searching = query.trim().length > 0

  return (
    <div className="space-y-6">
      <PageHeader title={t('add.title')} />

      {/* Nachtragen-Banner: alle Speicherpfade loggen auf das Zieldatum; X = zurück zu heute. */}
      {backdating && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 py-1.5 pl-3 pr-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <CalendarDays size={16} className="shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{t('add.forDate', { date: formatDayLong(activeDate) })}</span>
          </p>
          <button
            type="button"
            onClick={() => setActiveDate(null)}
            aria-label={t('add.forDateReset')}
            className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Mahlzeit-Auswahl */}
      <div className="flex flex-wrap gap-2">
        {MEALS.map((m) => (
          <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
        ))}
      </div>

      {/* KI- & Barcode-Erfassung — der schnellste Weg zuerst (PLAN §7.2).
          Beim Nachtragen ausgeblendet: Capture-/Barcode-Flows loggen fest auf
          heute (Review-Flow); fürs Nachtragen gibt es Suche/Vorrat/Manuell. */}
      {!backdating && (
        <div className="grid grid-cols-3 gap-3">
          {captureOptions.map(({ icon: Icon, key, to }) => (
            <motion.button
              key={key}
              whileTap={{ scale: 0.96 }}
              onClick={() => navigate(to)}
              className="focus-ring flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-4"
            >
              <Icon size={26} className="text-primary" />
              <span className="text-xs">{t(`add.${key}`)}</span>
            </motion.button>
          ))}
        </div>
      )}

      {/* Katalog-Suche über die eigenen Lebensmittel */}
      <section className="space-y-2">
        <div className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('add.searchPh')}
            aria-label={t('add.searchPh')}
            className="pl-10"
          />
        </div>
        {searching && results && (
          results.length > 0 ? (
            <div className="space-y-2">
              {results.map((f) => (
                <FoodRow key={f.id} food={f} onLog={() => void quickLog(f)} onPortionPhoto={backdating ? undefined : () => portionPhoto(f)} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('add.searchNone')}</p>
          )
        )}
      </section>

      {/* Mein Vorrat — täglicher Warenkorb: 1-Tap-Log mit gemerkter Portion
          oder Mengen-Sheet (Menge + Einheit + Mahlzeit) in 2-3 Taps. */}
      {!searching && pantry && pantry.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <ShoppingBasket size={16} aria-hidden="true" /> {t('add.pantry')}
          </h2>
          <div className="space-y-2">
            {pantry.map((f) => (
              <FoodRow
                key={f.id}
                food={f}
                onLog={() => void quickLog(f)}
                onPickAmount={() => setPortionFood(f)}
                showFavorite={false}
              />
            ))}
          </div>
        </section>
      )}

      {/* Favoriten — 1-Tap-Wiederholung, immer vor „zuletzt benutzt" */}
      {!searching && favorites && favorites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('add.favorites')}</h2>
          <div className="space-y-2">
            {favorites.map((f) => (
              <FoodRow key={f.id} food={f} onLog={() => void quickLog(f)} onPortionPhoto={backdating ? undefined : () => portionPhoto(f)} />
            ))}
          </div>
        </section>
      )}

      {/* Gestern kopieren — kontextbezogen auf die gewählte Mahlzeit (Befund 11) */}
      {!searching && yesterdayCount > 0 && (
        <div className="space-y-1">
          {yesterdayMealCount > 0 ? (
            <Button variant="secondary" className="w-full" onClick={() => void copyFromYesterday(false)}>
              <History size={18} />{' '}
              {t(backdating ? 'add.copyPrevDayMeal' : 'add.copyYesterdayMeal', { meal: t(`today.meals.${meal}`) })}
            </Button>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => void copyFromYesterday(true)}>
              <History size={18} /> {t(backdating ? 'add.copyPrevDayAll' : 'add.copyYesterdayAll')}
            </Button>
          )}
          {/* Zweitaktion „ganzen Tag" nur, wenn sie mehr kopiert als die Mahlzeit allein. */}
          {yesterdayMealCount > 0 && yesterdayCount > yesterdayMealCount && (
            <button
              type="button"
              onClick={() => void copyFromYesterday(true)}
              className="focus-ring mx-auto flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground"
            >
              {t(backdating ? 'add.copyPrevDayAll' : 'add.copyYesterdayAll')}
            </button>
          )}
        </div>
      )}

      {/* Zuletzt benutzt */}
      {!searching && recentsWithoutFavs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('entry.recent')}</h2>
          <div className="space-y-2">
            {recentsWithoutFavs.map((f) => (
              <FoodRow key={f.id} food={f} onLog={() => void quickLog(f)} onPortionPhoto={backdating ? undefined : () => portionPhoto(f)} />
            ))}
          </div>
        </section>
      )}

      {/* Katalog-Schnellzugriff: häufige Lebensmittel + Laster */}
      <CatalogQuickAdd
        title={t('catalog.common')}
        foods={FOOD_CATALOG.filter((f) => !f.vice)}
        onPick={(id) => void logCatalog(id)}
      />
      <CatalogQuickAdd
        title={t('catalog.vices')}
        foods={FOOD_CATALOG.filter((f) => f.vice)}
        onPick={(id) => void logCatalog(id)}
      />

      {/* Manuelles Erfassen */}
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('entry.title')}</h2>
        <Field label={t('entry.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('entry.namePh')} />
        </Field>
        {manualHits.length > 0 && (
          <div className="space-y-2">
            <p className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive">
              ⚠️ {t('review.allergyWarn', { list: allergenNames(manualHits) })}
            </p>
            <label className="flex items-start gap-2 text-xs text-destructive">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--destructive))]"
              />
              <span>{t('review.allergyAck')}</span>
            </label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('entry.per')}>
            <div role="group" aria-label={t('entry.unitToggle')} className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
              {(['g', 'ml'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={per === u}
                  onClick={() => setPer(u)}
                  className={`focus-ring min-h-[44px] rounded-sm text-sm font-medium ${
                    per === u ? 'bg-card shadow-sm' : 'text-muted-foreground'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('entry.kcal')}>
            <Input type="number" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('entry.protein')}>
            <Input type="number" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </Field>
          <Field label={t('entry.carbs')}>
            <Input type="number" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          </Field>
          <Field label={t('entry.fat')}>
            <Input type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
          </Field>
        </div>
        <Field label={`${t('entry.amount')} (${per})`}>
          <Input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>

        {/* Optionales Mahlzeitenfoto */}
        {photo ? (
          <div className="relative w-fit">
            <img src={photo} alt="" className="h-20 w-20 rounded-md object-cover" />
            <button
              onClick={() => setPhoto(null)}
              aria-label={t('common.delete')}
              className="focus-ring absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => photoRef.current?.click()}
            className="focus-ring flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input py-2.5 text-sm text-muted-foreground"
          >
            <ImagePlus size={18} /> {t('entry.photo')}
          </button>
        )}
        <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />

        <Button className="w-full" onClick={saveManual} disabled={!name.trim() || !kcal || (manualHits.length > 0 && !ack)}>
          {t('entry.save')}
        </Button>
      </Card>

      {/* Mengen-Sheet für den Verzehr aus dem Vorrat */}
      <PortionSheet
        food={portionFood}
        initialMeal={meal}
        onClose={() => setPortionFood(null)}
        onLogged={(entry, food) => {
          // Nachtragen: das Sheet loggt selbst fest auf heute — den frischen
          // Eintrag deshalb direkt auf das aktive Zieldatum verschieben.
          const target = getActiveDate()
          if (entry.date !== target) void setLogDate(entry.id, target)
          showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
          navigate('/')
        }}
      />
    </div>
  )
}

/**
 * Lebensmittel-Zeile mit 1-Tap-Log (gemerkte Portion), optional „Menge per Foto"
 * (Capture mode 'portion') bzw. Mengen-Sheet (Vorrat), Vorrat-Toggle und
 * Favoriten-Stern (48-px-Targets, aria-pressed).
 */
function FoodRow({
  food,
  onLog,
  onPortionPhoto,
  onPickAmount,
  showFavorite = true,
}: {
  food: FoodItem
  onLog: () => void
  onPortionPhoto?: () => void
  /** Öffnet das Mengen-Sheet (Vorrat-Zeilen). */
  onPickAmount?: () => void
  showFavorite?: boolean
}) {
  const { t } = useTranslation()
  const dp = food.defaultPortion
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-2">
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={onLog}
        className="focus-ring flex min-h-[48px] min-w-0 flex-1 items-center rounded-md px-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{food.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {food.kcal} kcal / 100 {food.per}
            {dp ? ` · ${describePortion(dp, t('today.edit.unitPortion'))}` : ''}
          </span>
        </span>
      </motion.button>
      {onPickAmount && (
        <button
          type="button"
          onClick={onPickAmount}
          aria-label={t('add.pantryAmount', { name: food.name })}
          className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <Scale size={20} />
        </button>
      )}
      {onPortionPhoto && (
        <button
          type="button"
          onClick={onPortionPhoto}
          aria-label={t('add.portionPhoto', { name: food.name })}
          className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <Camera size={20} />
        </button>
      )}
      <button
        type="button"
        onClick={() => void setPantry(food.id, !food.pantry)}
        aria-pressed={!!food.pantry}
        aria-label={t('add.pantryToggle', { name: food.name })}
        className={`focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${
          food.pantry ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <ShoppingBasket size={20} />
      </button>
      {showFavorite && (
        <button
          type="button"
          onClick={() => void toggleFavorite(food.id)}
          aria-pressed={!!food.favorite}
          aria-label={t('add.favToggle', { name: food.name })}
          className={`focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${
            food.favorite ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Star size={20} fill={food.favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  )
}

function CatalogQuickAdd({
  title,
  foods,
  onPick,
}: {
  title: string
  foods: { id: string; name: string }[]
  onPick: (id: string) => void
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {foods.map((f) => (
          <Chip key={f.id} label={f.name} selected={false} onClick={() => onPick(f.id)} />
        ))}
      </div>
    </section>
  )
}
