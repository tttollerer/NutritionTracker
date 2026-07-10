import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, CookingPot, ScanText, ScanBarcode, ImagePlus, Star, Search, History, ShoppingBasket, Scale } from 'lucide-react'
import {
  copyYesterday,
  deleteLog,
  favoriteFoods,
  logFood,
  pantryFoods,
  quickLogCatalog,
  recentFoods,
  searchFoods,
  setPantry,
  toggleFavorite,
  yesterdayLogCount,
} from '@/db/repo'
import { decrementPantryOnLog, incrementPantry, undoPantryAdd } from '@/lib/pantryStock'
import { useOverlays } from '@/lib/overlays-context'
import type { FoodItem, Meal } from '@/db/types'
import { defaultMeal, MEALS } from '@/lib/meal'
import { FOOD_CATALOG } from '@/lib/foodCatalog'
import { todayKey } from '@/lib/utils'
import { describePortion } from '@/lib/portion'
import { PageHeader } from '@/components/PageHeader'
import { PortionSheet } from '@/components/PortionSheet'
import { ProductSheet, type ProductDraft } from '@/components/FoodDetailSheet'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

export function Add() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const recents = useLiveQuery(() => recentFoods(), [])
  const favorites = useLiveQuery(() => favoriteFoods(), [])
  const pantry = useLiveQuery(() => pantryFoods(), [])
  // Vorrat-Verzehr über das Mengen-Sheet (Menge + Einheit + Mahlzeit).
  const [portionFood, setPortionFood] = useState<FoodItem | null>(null)
  const yesterdayCount = useLiveQuery(() => yesterdayLogCount(), []) ?? 0
  // Kontext für „Gestern kopieren" (Befund 11): Zähler der gewählten Mahlzeit.
  const yesterdayMealCount = useLiveQuery(() => yesterdayLogCount(todayKey(), meal), [meal]) ?? 0
  // Katalog-Suche (live über db.foods)
  const [query, setQuery] = useState('')
  const results = useLiveQuery(() => searchFoods(query), [query])

  // Neues Produkt übers gemeinsame Produkt-Sheet (Draft-Modus) anlegen.
  const [creating, setCreating] = useState<ProductDraft | null>(null)

  const captureOptions = [
    { icon: Camera, key: 'photo', to: `/capture?mode=meal&meal=${meal}` },
    { icon: ScanText, key: 'label', to: `/capture?mode=label&meal=${meal}` },
    { icon: ScanBarcode, key: 'barcode', to: `/barcode?meal=${meal}` },
  ] as const

  async function logCatalog(id: string) {
    const c = FOOD_CATALOG.find((f) => f.id === id)
    if (!c) return
    const entry = await quickLogCatalog(c, meal)
    showUndo(t('capture.added', { name: c.name }), () => deleteLog(entry.id))
    navigate('/')
  }

  async function quickLog(food: FoodItem) {
    const entry = await logFood({
      food,
      date: todayKey(),
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
    const copied = await copyYesterday(wholeDay ? undefined : meal)
    if (copied.length === 0) return
    showUndo(t('add.copiedYesterday', { count: copied.length }), async () => {
      await Promise.all(copied.map((c) => deleteLog(c.id)))
    })
    navigate('/')
  }

  // Favoriten stehen in der eigenen Sektion — aus „zuletzt benutzt" ausblenden.
  const recentsWithoutFavs = (recents ?? []).filter((f) => !f.favorite)
  const searching = query.trim().length > 0

  return (
    <div className="space-y-6">
      <PageHeader title={t('add.title')} />

      {/* Mahlzeit-Auswahl */}
      <div className="flex flex-wrap gap-2">
        {MEALS.map((m) => (
          <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
        ))}
      </div>

      {/* KI- & Barcode-Erfassung — der schnellste Weg zuerst (PLAN §7.2) */}
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

      {/* Eigene Rezepte: anlegen, bearbeiten und in einem Rutsch loggen */}
      <Button variant="secondary" className="w-full" onClick={() => navigate('/recipes')}>
        <CookingPot size={18} /> {t('recipes.entry')}
      </Button>

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
                <FoodRow key={f.id} food={f} onLog={() => void quickLog(f)} onPickAmount={() => setPortionFood(f)} onPortionPhoto={() => portionPhoto(f)} />
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
              <FoodRow key={f.id} food={f} onLog={() => void quickLog(f)} onPickAmount={() => setPortionFood(f)} onPortionPhoto={() => portionPhoto(f)} />
            ))}
          </div>
        </section>
      )}

      {/* Gestern kopieren — kontextbezogen auf die gewählte Mahlzeit (Befund 11) */}
      {!searching && yesterdayCount > 0 && (
        <div className="space-y-1">
          {yesterdayMealCount > 0 ? (
            <Button variant="secondary" className="w-full" onClick={() => void copyFromYesterday(false)}>
              <History size={18} /> {t('add.copyYesterdayMeal', { meal: t(`today.meals.${meal}`) })}
            </Button>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => void copyFromYesterday(true)}>
              <History size={18} /> {t('add.copyYesterdayAll')}
            </Button>
          )}
          {/* Zweitaktion „ganzen Tag" nur, wenn sie mehr kopiert als die Mahlzeit allein. */}
          {yesterdayMealCount > 0 && yesterdayCount > yesterdayMealCount && (
            <button
              type="button"
              onClick={() => void copyFromYesterday(true)}
              className="focus-ring mx-auto flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground"
            >
              {t('add.copyYesterdayAll')}
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
              <FoodRow key={f.id} food={f} onLog={() => void quickLog(f)} onPickAmount={() => setPortionFood(f)} onPortionPhoto={() => portionPhoto(f)} />
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

      {/* Neues Produkt anlegen — durchgängig über DAS gemeinsame Produkt-Sheet
          (Galerie mit mehreren Fotos, Tags, Portionseinheiten, Preis, MHD).
          Der Suchbegriff wird als Name vorbefüllt. */}
      <button
        type="button"
        onClick={() => setCreating({ name: query.trim() || undefined })}
        className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input py-2.5 text-sm font-medium text-muted-foreground"
      >
        <ImagePlus size={18} aria-hidden="true" /> {t('add.newProduct')}
      </button>

      {/* Mengen-Sheet für den Verzehr aus dem Vorrat — Loggen zieht eine
          Packung vom Bestand ab; Undo legt sie zurück. */}
      <PortionSheet
        food={portionFood}
        initialMeal={meal}
        onClose={() => setPortionFood(null)}
        onLogged={(entry, food) => {
          void (async () => {
            const took = await decrementPantryOnLog(food.id)
            showUndo(t('capture.added', { name: food.name }), async () => {
              await deleteLog(entry.id)
              if (took) await incrementPantry(food.id)
            })
          })()
          navigate('/')
        }}
      />

      {/* DAS gemeinsame Produkt-Sheet im Draft-Modus: „In den Vorrat" bleibt
          hier, „Anlegen & loggen" reicht das frische Produkt ans Mengen-Sheet. */}
      <ProductSheet
        food={null}
        draft={creating}
        onClose={() => setCreating(null)}
        onCreated={(food, action) => {
          setCreating(null)
          if (action === 'log') setPortionFood(food)
          else showUndo(t('food.create.createdPantry', { name: food.name }), () => undoPantryAdd(food.id))
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
