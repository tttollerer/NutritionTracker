import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Scale, ScanBarcode, ScanText, ShoppingBasket, X } from 'lucide-react'
import type { FoodItem, Meal } from '@/db/types'
import { deleteLog, logFood, pantryFoods, setPantry } from '@/db/repo'
import { useOverlays } from '@/lib/overlays-context'
import { defaultMeal, MEALS } from '@/lib/meal'
import { formatEuro } from '@/lib/money'
import { describePortion } from '@/lib/portion'
import { todayKey } from '@/lib/utils'
import { PortionSheet } from '@/components/PortionSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Das Zuhause des Vorrats-Features: „Ich habe eingekauft" bekommt hier einen
 * eigenen, sichtbaren Ort — getrennt vom Verzehr-Flow („Ich habe gegessen").
 * Einkauf scannen (Batch-Barcode) bzw. Nährwerttabelle fotografieren füllen den
 * Vorrat; jede Zeile loggt den Verzehr in 1 Tap mit gemerkter Portion + Undo
 * (gleiches Verhalten wie die Vorrat-Zeilen auf der Erfassen-Seite).
 */
export function Pantry() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const pantry = useLiveQuery(() => pantryFoods(), [])
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  // Verzehr mit Wunschmenge über das Mengen-Sheet (dort auch: Produkt bearbeiten).
  const [portionFood, setPortionFood] = useState<FoodItem | null>(null)

  /** 1-Tap-Log mit gemerkter Portion — Verhalten gespiegelt von Add.tsx. */
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

  /** Aus dem Vorrat nehmen — nicht löschen, deshalb mit Undo statt Rückfrage. */
  async function removeFromPantry(food: FoodItem) {
    await setPantry(food.id, false)
    showUndo(t('pantry.removed', { name: food.name }), () => setPantry(food.id, true))
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('common.back')}
          className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShoppingBasket size={24} aria-hidden="true" className="text-primary" /> {t('pantry.title')}
        </h1>
      </header>

      {pantry === undefined ? (
        // Lädt: Skeleton statt Spinner (eine Zeile pro erwartetem Item-Block).
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : pantry.length === 0 ? (
        // Empty State: Konzept in einem Satz, genau EINE offensichtliche Aktion.
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-input p-6 text-center">
          <ShoppingBasket size={40} aria-hidden="true" className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('pantry.emptyBody')}</p>
          <Button className="w-full" onClick={() => navigate('/barcode?pantry=1')}>
            <ScanBarcode size={18} /> {t('pantry.scan')}
          </Button>
        </div>
      ) : (
        <>
          {/* Einkauf einräumen: Scan als Primärweg, Tabelle-Foto als Zweitweg. */}
          <div className="space-y-2">
            <Button className="w-full" onClick={() => navigate('/barcode?pantry=1')}>
              <ScanBarcode size={18} /> {t('pantry.scan')}
            </Button>
            <Button variant="ghost" className="w-full border border-input" onClick={() => navigate('/capture?mode=label')}>
              <ScanText size={18} /> {t('pantry.labelPhoto')}
            </Button>
          </div>

          {/* Mahlzeit-Vorwahl für den 1-Tap-Verzehr (wie auf „Erfassen") */}
          <div className="flex flex-wrap gap-2">
            {MEALS.map((m) => (
              <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
            ))}
          </div>

          <div className="space-y-2">
            {pantry.map((f) => (
              <PantryRow
                key={f.id}
                food={f}
                onLog={() => void quickLog(f)}
                onPickAmount={() => setPortionFood(f)}
                onRemove={() => void removeFromPantry(f)}
              />
            ))}
          </div>
        </>
      )}

      {/* Mengen-Sheet: Menge + Einheit + Mahlzeit; darin auch „Bearbeiten" (FoodDetailSheet). */}
      <PortionSheet
        food={portionFood}
        initialMeal={meal}
        onClose={() => setPortionFood(null)}
        onLogged={(entry, food) => {
          showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
          navigate('/')
        }}
      />
    </div>
  )
}

/**
 * Vorrat-Zeile: großes 1-Tap-Log-Target (gemerkte Portion), Mengen-Button
 * (öffnet das PortionSheet) und „aus dem Vorrat entfernen" mit Undo.
 * Spiegelung der FoodRow aus Add.tsx — lokal nachgebaut, damit Add.tsx
 * unangetastet bleibt (48-px-Targets, aria-labels).
 */
function PantryRow({
  food,
  onLog,
  onPickAmount,
  onRemove,
}: {
  food: FoodItem
  onLog: () => void
  onPickAmount: () => void
  onRemove: () => void
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
          {/* Haushaltskasse: Kosten-Zeile nur, wenn ein Preis gepflegt ist. */}
          {food.price && (
            <span className="block truncate text-xs text-muted-foreground">
              {t('pantry.pricePerPack', { price: formatEuro(food.price.amount) })}
            </span>
          )}
        </span>
      </motion.button>
      <button
        type="button"
        onClick={onPickAmount}
        aria-label={t('add.pantryAmount', { name: food.name })}
        className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      >
        <Scale size={20} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('pantry.remove', { name: food.name })}
        className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      >
        <X size={20} />
      </button>
    </div>
  )
}
