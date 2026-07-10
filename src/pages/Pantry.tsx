import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Minus, Plus, Receipt, ScanBarcode, Search, ShoppingBasket, Utensils } from 'lucide-react'
import type { FoodItem, Photo } from '@/db/types'
import { db } from '@/db'
import { deleteLog, foodNameMatches, pantryFoods } from '@/db/repo'
import { decrementPantryOnLog, effectivePantryQty, incrementPantry, isExpiringSoon, setPantryQty, undoPantryAdd } from '@/lib/pantryStock'
import { formatEuro } from '@/lib/money'
import { defaultMeal } from '@/lib/meal'
import { cn } from '@/lib/utils'
import { useOverlays } from '@/lib/overlays-context'
import { PageHeader } from '@/components/PageHeader'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { ShoppingList } from '@/components/ShoppingList'
import { PortionSheet } from '@/components/PortionSheet'
import { FoodDetailSheet, type ProductDraft } from '@/components/FoodDetailSheet'
import { ExpiryBadge } from '@/components/ExpiryBadge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Einkauf / Vorrat als eigener Tab (Design 1c): Einkäufe landen per
 * Barcode-/Foto-KI-Scan im Vorrat, die Liste ist durchsuch- und per Tags
 * filterbar; „In Verzehr" loggt über das Mengen-Sheet in 1–2 Taps.
 * Zeilen-Tap öffnet das Lebensmittel-Detail (Galerie, Beschreibung, KI).
 */
export function Pantry() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const pantry = useLiveQuery(() => pantryFoods(), [])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  // „Bald leer"-Filter: nur Artikel mit höchstens 1 Packung im Bestand.
  const [lowOnly, setLowOnly] = useState(false)
  // „Läuft ab"-Filter: nur Artikel, deren MHD im Fenster liegt (inkl. abgelaufener).
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [portionFood, setPortionFood] = useState<FoodItem | null>(null)
  const [detailFood, setDetailFood] = useState<FoodItem | null>(null)
  // Neues Produkt übers gemeinsame Produkt-Sheet (Draft-Modus) anlegen.
  const [creating, setCreating] = useState<ProductDraft | null>(null)

  // Erste Produktfotos für die Thumbnails der Liste.
  const thumbs = useLiveQuery(async () => {
    if (!pantry) return undefined
    const ids = pantry.flatMap((f) => (f.photoIds?.[0] ? [f.photoIds[0]] : []))
    const rows = await db.photos.bulkGet(ids)
    const byId = new Map(rows.filter((p): p is Photo => !!p && !p.deletedAt).map((p) => [p.id, p.dataUrl]))
    return new Map(
      pantry.flatMap((f) => {
        const url = f.photoIds?.[0] ? byId.get(f.photoIds[0]) : undefined
        return url ? [[f.id, url] as const] : []
      }),
    )
  }, [pantry])

  // Filter-Chips aus den tatsächlich vergebenen Tags des Vorrats.
  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const f of pantry ?? []) for (const tg of f.tags ?? []) set.add(tg)
    return [...set].sort((a, b) => a.localeCompare(b, 'de'))
  }, [pantry])

  if (pantry === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('pantryPage.title')} />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }

  // Vorrats-Wert: Summe der bekannten Packungspreise (nur zeigen, wenn > 0).
  const pantryValue = pantry.reduce((a, f) => a + (f.price?.amount ?? 0), 0)
  const subtitle =
    t('pantryPage.subtitle', { count: pantry.length }) +
    (pantryValue > 0 ? ` · ${formatEuro(pantryValue)}` : '')

  const searching = query.trim().length > 0
  const filtered = pantry.filter(
    (f) =>
      (!searching || foodNameMatches(f.name, query)) &&
      (!tag || (f.tags ?? []).includes(tag)) &&
      (!lowOnly || effectivePantryQty(f) <= 1) &&
      (!expiringOnly || isExpiringSoon(f)),
  )

  return (
    <div className="space-y-4">
      <PageHeader title={t('pantryPage.title')} subtitle={subtitle}>
        {/* Neues Produkt von Hand anlegen — gleiches Produkt-Sheet wie überall. */}
        <button
          type="button"
          onClick={() => setCreating({})}
          aria-label={t('add.newProduct')}
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
        >
          <Plus size={20} />
        </button>
        <ProfileAvatar />
      </PageHeader>

      {/* Einkaufsliste: einklappbarer Abschnitt über dem Vorrat. */}
      <ShoppingList />

      {/* Scan-Einstiege: EIN Produkt-Scan (Nährwerttabelle ODER Barcode — die
          KI liest beides vom Foto, Review → „Nur in den Vorrat") & Kassenbon
          (alle Positionen → Vorrat). Barcode-Nummer manuell: Link darunter. */}
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/capture?mode=label')}
          className="focus-ring flex flex-col items-center gap-2 rounded-lg bg-brand-gradient p-4 text-primary-foreground shadow-glow"
        >
          <ScanBarcode size={26} />
          <span className="text-center text-sm font-bold">{t('pantryPage.scanProduct')}</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/capture?mode=receipt')}
          className="focus-ring flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <Receipt size={26} className="text-primary" />
          <span className="text-center text-sm font-bold">{t('pantryPage.scanReceipt')}</span>
        </motion.button>
      </div>
      {/* Fallback ohne Kamera: EAN-Nummer von Hand (auf Android auch Live-Scanner). */}
      <button
        type="button"
        onClick={() => navigate('/barcode?pantry=1')}
        className="focus-ring -mt-1 flex min-h-[44px] w-full items-center justify-center rounded-md text-xs font-medium text-muted-foreground"
      >
        {t('pantryPage.barcodeManual')}
      </button>

      {/* Suche */}
      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('pantryPage.searchPh')}
          aria-label={t('pantryPage.searchPh')}
          className="pl-10"
        />
      </div>

      {/* Filter: „Bald leer" (Bestand ≤ 1) + Tag-Chips aus dem Vorrat. */}
      {pantry.length > 0 && (
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          <FilterChip
            label={t('pantryPage.all')}
            selected={tag === null && !lowOnly && !expiringOnly}
            onClick={() => {
              setTag(null)
              setLowOnly(false)
              setExpiringOnly(false)
            }}
          />
          <FilterChip
            label={t('pantryPage.lowFilter')}
            selected={lowOnly}
            warning
            onClick={() => setLowOnly((v) => !v)}
          />
          <FilterChip
            label={t('pantryPage.expiringFilter')}
            selected={expiringOnly}
            warning
            onClick={() => setExpiringOnly((v) => !v)}
          />
          {tags.map((tg) => (
            <FilterChip key={tg} label={tg} selected={tag === tg} onClick={() => setTag(tag === tg ? null : tg)} />
          ))}
        </div>
      )}

      {pantry.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t('pantryPage.empty')}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pantryPage.searchNone')}</p>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((f) => (
            <PantryRow
              key={f.id}
              food={f}
              photoUrl={thumbs?.get(f.id)}
              onOpen={() => setDetailFood(f)}
              onConsume={() => setPortionFood(f)}
            />
          ))}
        </div>
      )}

      {/* Verzehr aus dem Vorrat: Mengen-Sheet (Menge + Einheit + Mahlzeit).
          Loggen zieht eine Packung vom Bestand ab; Undo legt sie zurück. */}
      <PortionSheet
        food={portionFood}
        initialMeal={defaultMeal()}
        onClose={() => setPortionFood(null)}
        onLogged={(entry, food) => {
          setPortionFood(null)
          void (async () => {
            const took = await decrementPantryOnLog(food.id)
            showUndo(t('capture.added', { name: food.name }), async () => {
              await deleteLog(entry.id)
              if (took) await incrementPantry(food.id)
            })
          })()
        }}
      />

      {/* Lebensmittel-Detail (Galerie · Beschreibung · KI · Preis · Tags). */}
      <FoodDetailSheet
        food={detailFood}
        draft={creating}
        onClose={() => {
          setDetailFood(null)
          setCreating(null)
        }}
        onSaved={(f) => setDetailFood(f)}
        onCreated={(food, action) => {
          setCreating(null)
          // Auf der Einkauf-Seite ist der Vorrat das natürliche Ziel; „Anlegen
          // & loggen" öffnet das Mengen-Sheet für den direkten Verzehr.
          if (action === 'log') setPortionFood(food)
          else showUndo(t('food.create.createdPantry', { name: food.name }), () => undoPantryAdd(food.id))
        }}
      />
    </div>
  )
}

function FilterChip({
  label,
  selected,
  warning = false,
  onClick,
}: {
  label: string
  selected: boolean
  /** Amber-Variante für den „Bald leer"-Filter (warning-Tokens). */
  warning?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'focus-ring min-h-[40px] shrink-0 rounded-full border px-4 text-sm font-medium',
        selected
          ? warning
            ? 'border-warning bg-warning/15 text-warning-text'
            : 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function PantryRow({
  food,
  photoUrl,
  onOpen,
  onConsume,
}: {
  food: FoodItem
  photoUrl?: string
  onOpen: () => void
  onConsume: () => void
}) {
  const { t } = useTranslation()
  const firstTag = food.tags?.[0]
  const qty = effectivePantryQty(food)
  // Sekundärzeile: Packung · Preis (Haushaltskasse), sonst kcal-Dichte.
  const meta = food.price
    ? `${food.price.per} ${food.per} · ${formatEuro(food.price.amount)}`
    : `${food.kcal} kcal / 100 ${food.per}`
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-sm">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('pantryPage.open', { name: food.name })}
          className="focus-ring flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-md text-left"
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ShoppingBasket size={20} />
            </span>
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">{food.name}</span>
              {firstTag && (
                <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {firstTag}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">{meta}</span>
          </span>
        </button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          type="button"
          onClick={onConsume}
          aria-label={t('pantryPage.consume', { name: food.name })}
          className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"
        >
          <Utensils size={20} />
        </motion.button>
      </div>

      {/* Bestand: Stepper zum Korrigieren + „bald leer"-Chip (qty ≤ 1). */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void setPantryQty(food.id, qty - 1)}
            disabled={qty <= 0}
            aria-label={t('pantryPage.stockDec', { name: food.name })}
            className="focus-ring flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40"
          >
            <Minus size={18} />
          </button>
          <span className="min-w-[6.5rem] text-center text-xs tabular-nums text-muted-foreground">
            {t('pantryPage.stock', { count: qty })}
          </span>
          <button
            type="button"
            onClick={() => void setPantryQty(food.id, qty + 1)}
            aria-label={t('pantryPage.stockInc', { name: food.name })}
            className="focus-ring flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {/* MHD-Badge: gleiche Regel wie der „Läuft ab"-Filter (isExpiringSoon). */}
          {isExpiringSoon(food) && <ExpiryBadge expiryDate={food.expiryDate!} />}
          {qty <= 1 && (
            <span className="shrink-0 rounded-full border border-warning/40 bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning-text">
              {t('pantryPage.lowStock')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
