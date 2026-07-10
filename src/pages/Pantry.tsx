import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ScanBarcode, Search, ShoppingBasket, Sparkles, Utensils } from 'lucide-react'
import type { FoodItem, Photo } from '@/db/types'
import { db } from '@/db'
import { deleteLog, foodNameMatches, pantryFoods } from '@/db/repo'
import { formatEuro } from '@/lib/money'
import { defaultMeal } from '@/lib/meal'
import { cn } from '@/lib/utils'
import { useOverlays } from '@/lib/overlays-context'
import { PageHeader } from '@/components/PageHeader'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { PortionSheet } from '@/components/PortionSheet'
import { FoodDetailSheet } from '@/components/FoodDetailSheet'
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
  const [portionFood, setPortionFood] = useState<FoodItem | null>(null)
  const [detailFood, setDetailFood] = useState<FoodItem | null>(null)

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
    (f) => (!searching || foodNameMatches(f.name, query)) && (!tag || (f.tags ?? []).includes(tag)),
  )

  return (
    <div className="space-y-4">
      <PageHeader title={t('pantryPage.title')} subtitle={subtitle}>
        <ProfileAvatar />
      </PageHeader>

      {/* Scan-Einstiege: Barcode (Ziel Vorrat) & Foto/KI (Review → „Nur in den Vorrat"). */}
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/barcode?pantry=1')}
          className="focus-ring flex flex-col items-center gap-2 rounded-lg bg-brand-gradient p-4 text-primary-foreground shadow-glow"
        >
          <ScanBarcode size={26} />
          <span className="text-sm font-bold">{t('pantryPage.scanBarcode')}</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/capture?mode=label')}
          className="focus-ring flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <Sparkles size={26} className="text-primary" />
          <span className="text-sm font-bold">{t('pantryPage.photoAi')}</span>
        </motion.button>
      </div>

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

      {/* Tag-Filter — nur wenn der Vorrat überhaupt Tags hat. */}
      {tags.length > 0 && (
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          <FilterChip label={t('pantryPage.all')} selected={tag === null} onClick={() => setTag(null)} />
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

      {/* Verzehr aus dem Vorrat: Mengen-Sheet (Menge + Einheit + Mahlzeit). */}
      <PortionSheet
        food={portionFood}
        initialMeal={defaultMeal()}
        onClose={() => setPortionFood(null)}
        onLogged={(entry, food) => {
          setPortionFood(null)
          showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
        }}
      />

      {/* Lebensmittel-Detail (Galerie · Beschreibung · KI · Preis · Tags). */}
      <FoodDetailSheet food={detailFood} onClose={() => setDetailFood(null)} onSaved={(f) => setDetailFood(f)} />
    </div>
  )
}

function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'focus-ring min-h-[40px] shrink-0 rounded-full border px-4 text-sm font-medium',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground',
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
  // Sekundärzeile: Packung · Preis (Haushaltskasse), sonst kcal-Dichte.
  const meta = food.price
    ? `${food.price.per} ${food.per} · ${formatEuro(food.price.amount)}`
    : `${food.kcal} kcal / 100 ${food.per}`
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 shadow-sm">
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
  )
}
