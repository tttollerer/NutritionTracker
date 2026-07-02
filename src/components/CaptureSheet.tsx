import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, ScanText, Barcode, PencilLine, Check, Image as ImageIcon } from 'lucide-react'
import type { FoodItem, Meal } from '@/db/types'
import { logFood, recentFoods, deleteLog } from '@/db/repo'
import { downscaleImage } from '@/lib/image'
import { setPendingImage } from '@/lib/captureHandoff'
import { defaultMeal, MEALS } from '@/lib/meal'
import { todayKey } from '@/lib/utils'
import { Chip } from '@/components/ui/Chip'

interface Props {
  open: boolean
  onClose: () => void
  showUndo: (label: string, undo: () => void | Promise<void>) => void
}

/** Erfass-Quick-Sheet: „Essen fotografieren" öffnet direkt die Kamera → dann Vorschau. */
export function CaptureSheet({ open, onClose, showUndo }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const recents = useLiveQuery(() => recentFoods(6), [])

  const mealCamRef = useRef<HTMLInputElement>(null)
  const mealGalRef = useRef<HTMLInputElement>(null)
  const labelCamRef = useRef<HTMLInputElement>(null)

  // Aufgenommenes/gewähltes Bild verkleinern, übergeben und direkt zur Vorschau.
  async function onFile(mode: 'meal' | 'label', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const img = await downscaleImage(file)
    setPendingImage(img)
    onClose()
    navigate(`/capture?mode=${mode}&meal=${meal}`)
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl"
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

            {/* Hero: Foto (öffnet direkt die Kamera) */}
            <button
              onClick={() => mealCamRef.current?.click()}
              className="flex w-full items-center gap-4 rounded-2xl bg-primary p-5 text-left text-primary-foreground"
            >
              <Camera size={32} strokeWidth={2.2} />
              <span>
                <span className="block text-lg font-semibold">{t('capture.take')}</span>
                <span className="block text-sm opacity-90">{t('capture.sheetPhotoHint')}</span>
              </span>
            </button>

            {/* Aus Galerie (falls kein Live-Foto) */}
            <button
              onClick={() => mealGalRef.current?.click()}
              className="mt-2 flex w-full items-center justify-center gap-2 py-1.5 text-sm text-muted-foreground"
            >
              <ImageIcon size={16} /> {t('capture.choose')}
            </button>

            {/* Sekundär: Tabelle (Kamera direkt) + Barcode */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <SheetTile icon={ScanText} label={t('add.label')} onClick={() => labelCamRef.current?.click()} />
              <SheetTile icon={Barcode} label={t('add.barcode')} onClick={() => { onClose(); navigate(`/barcode?meal=${meal}`) }} />
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
              onClick={() => { onClose(); navigate('/add') }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-input py-2.5 text-sm text-muted-foreground"
            >
              <PencilLine size={16} /> {t('add.manual')}
            </button>
          </motion.div>

          {/* Versteckte Datei-Eingaben: Kamera (capture) + Galerie */}
          <input ref={mealCamRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile('meal', e)} />
          <input ref={mealGalRef} type="file" accept="image/*" hidden onChange={(e) => void onFile('meal', e)} />
          <input ref={labelCamRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile('label', e)} />
        </>
      )}
    </AnimatePresence>
  )
}

function SheetTile({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background p-4">
      <Icon size={24} className="text-primary" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}
