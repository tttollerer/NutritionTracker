import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ShoppingBasket, UtensilsCrossed } from 'lucide-react'
import { lookupBarcode } from '@/lib/openfoodfacts'
import { toApiError } from '@/lib/apiError'
import { setReview } from '@/lib/reviewStore'
import { addToPantry, setFoodPrice, setPantry } from '@/db/repo'
import { useOverlays } from '@/lib/overlays-context'
import { parsePositiveNumber } from '@/lib/money'
import type { Meal } from '@/db/types'
import { defaultMeal } from '@/lib/meal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

// BarcodeDetector ist (noch) nicht in den TS-DOM-Typen.
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

/**
 * Nach Fehltreffer ODER Vorrat-Treffer denselben Code kurz ignorieren, sonst
 * feuert der Scan-Loop im Sekundentakt (bzw. legt dasselbe Produkt mehrfach ab).
 */
const RESCAN_COOLDOWN_MS = 4000

/** Zuletzt in den Vorrat gelegtes Produkt — für die optionale Preis-Eingabe. */
interface LastPantryItem {
  foodId: string
  name: string
}

export function Barcode() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { showUndo } = useOverlays()
  const meal = (params.get('meal') as Meal) || defaultMeal()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  // i18n-Key der Meldung (capture.notFound oder errors.*), nie ein roher Fehlertext.
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  // Ziel des Scans: Mahlzeit loggen (Standard) oder Einkauf in den Vorrat.
  // ?pantry=1 (z. B. aus dem Erfass-Sheet) startet direkt im Vorrat-Modus.
  const [target, setTarget] = useState<'log' | 'pantry'>(params.get('pantry') ? 'pantry' : 'log')
  const targetRef = useRef(target)
  targetRef.current = target
  // Fortschrittsgefühl beim Batch-Scan: in dieser Session eingeräumte Produkte.
  const [pantryCount, setPantryCount] = useState(0)
  // Preis-Nachtrag (Haushaltskasse) zum zuletzt gescannten Vorrat-Produkt.
  const [lastPantry, setLastPantry] = useState<LastPantryItem | null>(null)
  const [priceText, setPriceText] = useState('')
  const [packText, setPackText] = useState('')
  // Refs für den rAF-Loop: kein Re-Subscribe des Kamera-Effekts nötig.
  const busyRef = useRef(false)
  const lastMissRef = useRef<{ code: string; at: number } | null>(null)

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o?: unknown) => BarcodeDetectorLike })
      .BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) return

    let stream: MediaStream | null = null
    let raf = 0
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
    let stopped = false

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setScanning(true)
        }
        const tick = async () => {
          if (stopped || !videoRef.current) return
          // Während eines laufenden Lookups nicht erneut detecten — der Loop
          // läuft danach weiter (kein dauerhafter Stopp nach Fehltreffer).
          if (!busyRef.current) {
            try {
              const codes = await detector.detect(videoRef.current)
              const raw = codes[0]?.rawValue?.trim()
              const miss = lastMissRef.current
              if (raw && !(miss && miss.code === raw && Date.now() - miss.at < RESCAN_COOLDOWN_MS)) {
                void handleCode(raw)
              }
            } catch {
              /* einzelne Frames können fehlschlagen */
            }
          }
          if (!stopped) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setScanning(false)
      }
    })()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCode(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setErrorKey(null)
    try {
      const product = await lookupBarcode(trimmed)
      if (!product) {
        // Nicht gefunden → Meldung zeigen, Scan-Loop läuft weiter.
        lastMissRef.current = { code: trimmed, at: Date.now() }
        setErrorKey('capture.notFound')
        return
      }
      if (targetRef.current === 'pantry') {
        // Einkauf-Batch-Scan: Upsert per Barcode mit pantry=true, KEIN LogEntry.
        // Der Scanner läuft direkt weiter → mehrere Einkäufe in Serie.
        const food = await addToPantry({
          ...product.food,
          name: product.food.name || t('capture.unknownProduct'),
        })
        lastMissRef.current = { code: trimmed, at: Date.now() } // nicht sofort erneut ablegen
        setLastPantry({ foodId: food.id, name: food.name })
        setPantryCount((c) => c + 1)
        // Preis-Felder fürs neue Produkt vorbelegen: Packungsgröße aus OFF, falls vorhanden.
        setPriceText(food.price ? String(food.price.amount).replace('.', ',') : '')
        setPackText(food.price ? String(food.price.per) : product.packageSize ? String(product.packageSize) : '')
        showUndo(t('capture.pantrySaved', { name: food.name }), async () => {
          await setPantry(food.id, false)
          setPantryCount((c) => Math.max(0, c - 1)) // Zähler bleibt ehrlich
        })
        return
      }
      setReview({
        items: [
          {
            name: product.food.name || t('capture.unknownProduct'),
            amount: 100,
            unit: 'g',
            per100: {
              kcal: product.food.kcal,
              protein: product.food.protein,
              carbs: product.food.carbs,
              fat: product.food.fat,
              micros: product.food.micros,
            },
          },
        ],
        meal,
        source: 'openfoodfacts',
        barcode: trimmed,
        allergens: product.allergens,
        traces: product.traces,
      })
      navigate('/review')
    } catch (e) {
      lastMissRef.current = { code: trimmed, at: Date.now() }
      setErrorKey(toApiError(e).i18nKey)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // Optionaler Preis-Nachtrag zum zuletzt abgelegten Vorrat-Produkt (Haushaltskasse).
  const priceVal = parsePositiveNumber(priceText)
  const packVal = parsePositiveNumber(packText)
  async function savePrice() {
    if (!lastPantry || priceVal == null || packVal == null) return
    await setFoodPrice(lastPantry.foodId, { amount: priceVal, per: packVal })
    setLastPantry(null)
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
            className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
          >
            <ChevronLeft size={24} />
          </button>
          {/* Titel folgt dem mentalen Modell: „Einkauf scannen" statt „Barcode scannen". */}
          <h1 className="text-2xl font-bold">
            {target === 'pantry' ? t('capture.pantryScanTitle') : t('capture.barcodeTitle')}
          </h1>
        </div>
        {target === 'pantry' && <p className="pl-14 text-sm text-muted-foreground">{t('capture.pantryHint')}</p>}
      </header>

      {/* Ziel-Umschalter als Segmented Control: „Ich habe gegessen" vs.
          „Ich habe eingekauft" — Icons tragen die Unterscheidung mit. */}
      <div role="group" aria-label={t('capture.targetToggle')} className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {(
          [
            { key: 'log', icon: UtensilsCrossed, label: t('capture.targetLog') },
            { key: 'pantry', icon: ShoppingBasket, label: t('capture.targetPantry') },
          ] as const
        ).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={target === key}
            onClick={() => setTarget(key)}
            className={`focus-ring flex min-h-[48px] items-center justify-center gap-2 rounded-sm text-sm font-medium transition-colors ${
              target === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <Icon size={18} aria-hidden="true" className={target === key ? 'text-primary' : undefined} /> {label}
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        {busy && (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white"
          >
            <Spinner size={32} />
            <p className="text-sm font-medium">{t('capture.searching')}</p>
          </div>
        )}
      </div>

      {/* Optionale Preis-Eingabe zum zuletzt abgelegten Produkt — der Scanner
          läuft währenddessen weiter (Batch-Einkauf: scannen, Preis, weiter). */}
      {lastPantry && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ShoppingBasket size={16} aria-hidden="true" className="text-primary" />
            <span className="min-w-0 truncate">{t('capture.pantrySaved', { name: lastPantry.name })}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('add.pantryPrice')}>
              <Input
                type="text"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder="2,49"
              />
            </Field>
            <Field label={t('add.pantryPackSize', { unit: 'g' })}>
              <Input
                type="text"
                inputMode="decimal"
                value={packText}
                onChange={(e) => setPackText(e.target.value)}
                placeholder="500"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 border border-input" onClick={() => setLastPantry(null)}>
              {t('capture.priceSkip')}
            </Button>
            <Button className="flex-1" disabled={priceVal == null || packVal == null} onClick={() => void savePrice()}>
              {t('capture.priceSave')}
            </Button>
          </div>
        </div>
      )}

      {/* Batch-Abschluss: dezenter Session-Zähler + „Fertig" führt zum Vorrat.
          replace: true, damit Zurück vom Vorrat nicht wieder im Scanner landet. */}
      {target === 'pantry' && (
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="min-w-0 truncate text-sm text-muted-foreground">
            {pantryCount > 0 ? t('capture.pantryCount', { count: pantryCount }) : ''}
          </p>
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => navigate('/pantry', { replace: true })}
          >
            {t('capture.pantryDone')}
          </Button>
        </div>
      )}

      {!scanning && <p className="text-sm text-muted-foreground">{t('capture.noCamera')}</p>}
      {errorKey && (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="text-destructive">{t(errorKey)}</p>
          {errorKey === 'errors.offline' && (
            <Button variant="secondary" className="w-full" onClick={() => navigate('/add')}>
              {t('errors.manualFallback')}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Input
          inputMode="numeric"
          placeholder={t('capture.manualBarcode')}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <Button className="w-full" disabled={!manual.trim() || busy} onClick={() => handleCode(manual)}>
          {busy ? <Spinner size={18} /> : t('capture.scan')}
        </Button>
      </div>
    </div>
  )
}
