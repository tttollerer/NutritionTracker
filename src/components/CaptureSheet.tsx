import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, CookingPot, ScanBarcode, PencilLine, Check, History, ShoppingBasket, Image as ImageIcon } from 'lucide-react'
import type { FoodItem, Meal } from '@/db/types'
import { db } from '@/db'
import { copyYesterday, pantryFoods, recentFoods, deleteLog, yesterdayMealSummary } from '@/db/repo'
import { decrementPantryOnLog, effectivePantryQty, incrementPantry } from '@/lib/pantryStock'
import { logMany, undoLogMany, usualPortionKcal } from '@/lib/logMany'
import { affinityStartKey, mealAffinityCounts, sortByMealAffinity } from '@/lib/mealAffinity'
import { downscaleImage } from '@/lib/image'
import { setPendingImage } from '@/lib/captureHandoff'
import { defaultMeal, MEALS } from '@/lib/meal'
import { cn, todayKey } from '@/lib/utils'
import { Chip } from '@/components/ui/Chip'
import { PortionSheet } from '@/components/PortionSheet'

interface Props {
  open: boolean
  onClose: () => void
  showUndo: (label: string, undo: () => void | Promise<void>) => void
}

/** Fokussierbare Elemente im Sheet (für Initial-Fokus & Fokus-Trap). */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Erfass-Quick-Sheet: „Essen fotografieren" öffnet direkt die Kamera → dann Vorschau. */
export function CaptureSheet({ open, onClose, showUndo }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  // Größerer Kandidaten-Pool als angezeigt wird (6): die Affinitäts-Sortierung
  // kann so z. B. morgens Frühstücks-Produkte von weiter hinten nach vorn holen.
  const recents = useLiveQuery(() => recentFoods(12), [])
  // „Gegessen aus dem Vorrat": die naheliegendste Quelle beim Tracken —
  // nur Produkte mit Bestand (> 0 Packungen), frisch benutzte zuerst.
  const pantry = useLiveQuery(async () => (await pantryFoods()).filter((f) => effectivePantryQty(f) > 0), [])
  // Routine-Chip „{Mahlzeit} wie gestern": reagiert auf die Mahlzeit-Auswahl.
  const yesterday = useLiveQuery(() => yesterdayMealSummary(meal), [meal])
  // Tageszeit-Affinität: Verzehr-Logs der letzten 14 Tage (ohne planned —
  // Wochenplan-Einträge zählen nie als Verzehr) einmal laden, pure sortieren.
  const affinityLogs = useLiveQuery(
    () =>
      db.logs
        .where('date')
        .between(affinityStartKey(), todayKey(), true, true)
        .filter((l) => !l.deletedAt && !l.planned)
        .toArray(),
    [],
  )
  const sheetRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Mahlzeit bei JEDEM Öffnen neu anhand der Uhrzeit vorschlagen — der
  // useState-Initialwert läuft nur einmal beim App-Start (Audit-Befund 5).
  // Die Mehrfach-Auswahl startet dabei immer frisch im Einzel-Tap-Modus.
  useEffect(() => {
    if (open) {
      setMeal(defaultMeal())
      setMultiSelect(false)
      setSelectedIds(new Set())
    }
  }, [open])

  const mealCamRef = useRef<HTMLInputElement>(null)
  const mealGalRef = useRef<HTMLInputElement>(null)
  const labelCamRef = useRef<HTMLInputElement>(null)

  // Fokus-Management: beim Öffnen Fokus ins Sheet, beim Schließen zurück zum Auslöser.
  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const raf = requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      triggerRef.current?.focus()
    }
  }, [open])

  // Escape schließt, Tab zirkuliert im Sheet (leichtgewichtiger Fokus-Trap).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const nodes = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!nodes || nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function go(path: string) {
    onClose()
    navigate(path)
  }

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

  // „Zuletzt benutzt" öffnet das Mengen-Sheet (Menge + Einheit wählbar: Stück,
  // Gramm, Dose … was fürs Produkt sinnvoll ist) statt sofort zu loggen — die
  // übliche Portion ist vorbelegt, Bestätigen kostet genau EINEN weiteren Tap.
  const [portionFood, setPortionFood] = useState<FoodItem | null>(null)
  function pickRecent(food: FoodItem) {
    onClose()
    setPortionFood(food)
  }

  // Mehrfach-Auswahl im Vorrat: ein Abendessen aus mehreren Komponenten ist
  // EIN Vorgang — Taps togglen die Produkte, der Footer-Button loggt alle
  // zusammen mit üblicher Portion und EIN Undo nimmt alles zurück (logMany).
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  function toggleMultiSelect() {
    setMultiSelect((on) => !on)
    setSelectedIds(new Set())
  }
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function logSelected(foods: FoodItem[]) {
    if (foods.length === 0) return
    const logged = await logMany(foods, meal)
    showUndo(t('capture.multiAdded', { count: logged.length }), () => undoLogMany(logged))
    onClose()
  }

  // „Wie gestern": die gestrige Mahlzeit 1:1 auf heute kopieren (Muster
  // Add.tsx copyFromYesterday) — das Undo löscht alle Kopien wieder.
  async function logLikeYesterday() {
    const copied = await copyYesterday(meal)
    if (copied.length === 0) return
    showUndo(t('add.copiedYesterday', { count: copied.length }), async () => {
      await Promise.all(copied.map((c) => deleteLog(c.id)))
    })
    onClose()
  }

  // Vorrat & „Zuletzt benutzt" nach Tageszeit-Affinität: was zur gewählten
  // Mahlzeit oft gegessen wird, steht vorn (morgens die Frühstücks-Produkte).
  const affinity = mealAffinityCounts(affinityLogs ?? [], meal)
  const pantryChips = sortByMealAffinity(pantry ?? [], affinity).slice(0, 8)
  // Für den Footer-Button: gewählte Produkte + kcal-Schätzung der üblichen Portionen.
  const selectedFoods = pantryChips.filter((f) => selectedIds.has(f.id))
  const selectedKcal = selectedFoods.reduce((sum, f) => sum + usualPortionKcal(f), 0)
  const recentChips = sortByMealAffinity(
    (recents ?? []).filter((f) => !pantry?.some((p) => p.id === f.id)),
    affinity,
  ).slice(0, 6)

  return (
    <>
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
            aria-hidden="true"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-label={t('capture.sheetTitle')}
            ref={sheetRef}
            onKeyDown={onKeyDown}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />

            {/* Mahlzeit-Auswahl */}
            <div className="mb-4 flex flex-wrap justify-center gap-2">
              {MEALS.map((m) => (
                <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
              ))}
            </div>

            {/* Routine in 1 Tap: dieselbe Mahlzeit wie gestern — nur wenn es
                gestern zur gewählten Mahlzeit Einträge gab. */}
            {yesterday && yesterday.count > 0 && (
              <button
                onClick={() => void logLikeYesterday()}
                className="focus-ring mb-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-primary-soft px-4 text-sm font-semibold text-primary"
              >
                <History size={16} aria-hidden="true" />
                {t('capture.likeYesterday', {
                  count: yesterday.count,
                  meal: t(`today.meals.${meal}`),
                  kcal: yesterday.kcal,
                })}
              </button>
            )}

            {/* Hero: Foto (öffnet direkt die Kamera) */}
            <button
              onClick={() => mealCamRef.current?.click()}
              className="focus-ring flex w-full items-center gap-4 rounded-lg bg-primary p-5 text-left text-primary-foreground"
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
              className="focus-ring mt-2 flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-sm text-muted-foreground"
            >
              <ImageIcon size={16} /> {t('capture.choose')}
            </button>

            {/* Sekundär: EIN Produkt-Scan (Nährwerttabelle ODER Barcode — die KI
                liest beides vom Foto) + eigene Rezepte. */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <SheetTile icon={ScanBarcode} label={t('add.label')} onClick={() => labelCamRef.current?.click()} />
              <SheetTile icon={CookingPot} label={t('recipes.tile')} onClick={() => go('/recipes')} />
            </div>

            {/* Dezenter Einstieg: ganzer Einkauf per Kassenbon-Foto → Vorrat
                (funktioniert überall — kein nativer Barcode-Scanner nötig). */}
            <button
              onClick={() => go('/capture?mode=receipt')}
              className="focus-ring mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md text-sm text-muted-foreground"
            >
              <ShoppingBasket size={16} aria-hidden="true" /> {t('capture.pantryEntry')}
            </button>

            {/* Mein Vorrat: gegessen wird meist, was da ist — Tap öffnet das
                Mengen-Sheet (wieviel? in Stück/Gramm/Dose …), Bestand zählt runter.
                „Mehrere wählen" schaltet auf Auswahl-Modus um: Taps togglen die
                Produkte, der Button darunter loggt alle in EINEM Vorgang. */}
            {pantry && pantry.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{t('add.pantry')}</p>
                  <div className="flex items-baseline gap-3">
                    <button
                      onClick={toggleMultiSelect}
                      aria-pressed={multiSelect}
                      className={cn(
                        'focus-ring rounded-md text-xs font-medium',
                        multiSelect ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {t('capture.multiToggle')}
                    </button>
                    {pantry.length > 8 && (
                      <button
                        onClick={() => go('/pantry')}
                        className="focus-ring rounded-md text-xs font-medium text-primary"
                      >
                        {t('capture.pantryAll', { count: pantry.length })}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pantryChips.map((f) => {
                    const isSelected = multiSelect && selectedIds.has(f.id)
                    return (
                      <button
                        key={f.id}
                        onClick={() => (multiSelect ? toggleSelected(f.id) : pickRecent(f))}
                        aria-label={multiSelect ? t('capture.multiPick', { name: f.name }) : t('pantryPage.consume', { name: f.name })}
                        aria-pressed={multiSelect ? isSelected : undefined}
                        className={cn(
                          'focus-ring flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                          isSelected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-background',
                        )}
                      >
                        {isSelected ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          <ShoppingBasket size={14} className="text-primary" aria-hidden="true" />
                        )}{' '}
                        {f.name}
                        {effectivePantryQty(f) > 1 && (
                          <span className="text-xs tabular-nums text-muted-foreground">×{effectivePantryQty(f)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {multiSelect && selectedFoods.length > 0 && (
                  <button
                    onClick={() => void logSelected(selectedFoods)}
                    className="focus-ring mt-3 flex min-h-[48px] w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  >
                    {t('capture.multiLog', { count: selectedFoods.length, kcal: selectedKcal })}
                  </button>
                )}
              </div>
            )}

            {/* Zuletzt benutzt: 1 Tipp — ohne Dubletten zur Vorrats-Sektion. */}
            {recentChips.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('entry.recent')}</p>
                <div className="flex flex-wrap gap-2">
                  {recentChips.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => pickRecent(f)}
                      className="focus-ring flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm"
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

          {/* Versteckte Datei-Eingaben: Kamera (capture) + Galerie */}
          <input ref={mealCamRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile('meal', e)} />
          <input ref={mealGalRef} type="file" accept="image/*" hidden onChange={(e) => void onFile('meal', e)} />
          <input ref={labelCamRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile('label', e)} />
        </>
      )}
    </AnimatePresence>

    {/* Mengen-Sheet für „Zuletzt benutzt" — lebt außerhalb des open-Zweigs,
        damit es das Schließen des Quick-Sheets überlebt. Vorrats-Produkte
        verhalten sich wie überall: eine Packung ab, Undo legt sie zurück. */}
    <PortionSheet
      food={portionFood}
      initialMeal={meal}
      onClose={() => setPortionFood(null)}
      onLogged={(entry, food) => {
        void (async () => {
          const took = food.pantry ? await decrementPantryOnLog(food.id) : false
          showUndo(t('capture.added', { name: food.name }), async () => {
            await deleteLog(entry.id)
            if (took) await incrementPantry(food.id)
          })
        })()
      }}
    />
    </>
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
