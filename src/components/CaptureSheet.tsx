import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, ScanText, ScanBarcode, PencilLine, Check } from 'lucide-react'
import type { FoodItem, Meal } from '@/db/types'
import { logFood, recentFoods, deleteLog } from '@/db/repo'
import { defaultMeal, MEALS } from '@/lib/meal'
import { todayKey } from '@/lib/utils'
import { Chip } from '@/components/ui/Chip'

interface Props {
  open: boolean
  onClose: () => void
  showUndo: (label: string, undo: () => void | Promise<void>) => void
}

/** Erfass-Quick-Sheet: in 2 Tipps zur Kamera. Vom +-Button & der Heute-Karte geöffnet. */
export function CaptureSheet({ open, onClose, showUndo }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const recents = useLiveQuery(() => recentFoods(6), [])

  function go(path: string) {
    onClose()
    navigate(path)
  }

  async function quickLog(food: FoodItem) {
    const entry = await logFood({
      food,
      date: todayKey(),
      meal,
      amount: food.defaultPortion?.amount ?? 100,
      unit: food.defaultPortion?.unit ?? (food.per as 'g' | 'ml'),
    })
    onClose()
    showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
  }

  return (
    <AnimatePresence>
      {open && (
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
            aria-label={t('capture.sheetTitle')}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />

            {/* Mahlzeit-Auswahl */}
            <div className="mb-4 flex flex-wrap justify-center gap-2">
              {MEALS.map((m) => (
                <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
              ))}
            </div>

            {/* Hero: Foto */}
            <button
              onClick={() => go(`/capture?mode=meal&meal=${meal}`)}
              className="focus-ring flex w-full items-center gap-4 rounded-lg bg-primary p-5 text-left text-primary-foreground"
            >
              <Camera size={32} strokeWidth={2.2} />
              <span>
                <span className="block text-lg font-semibold">{t('capture.take')}</span>
                <span className="block text-sm opacity-90">{t('capture.sheetPhotoHint')}</span>
              </span>
            </button>

            {/* Sekundär: Tabelle + Barcode */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <SheetTile icon={ScanText} label={t('add.label')} onClick={() => go(`/capture?mode=label&meal=${meal}`)} />
              <SheetTile icon={ScanBarcode} label={t('add.barcode')} onClick={() => go(`/barcode?meal=${meal}`)} />
            </div>

            {/* Zuletzt benutzt: 1 Tipp */}
            {recents && recents.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('entry.recent')}</p>
                <div className="flex flex-wrap gap-2">
                  {recents.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => quickLog(f)}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm"
                    >
                      <Check size={14} className="text-primary" /> {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Manuell (seltenster Weg) */}
            <button
              onClick={() => go('/add')}
              className="focus-ring mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input py-2.5 text-sm text-muted-foreground"
            >
              <PencilLine size={16} /> {t('add.manual')}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function SheetTile({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="focus-ring flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background p-4">
      <Icon size={24} className="text-primary" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}
