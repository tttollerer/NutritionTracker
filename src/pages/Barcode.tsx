import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { lookupBarcode } from '@/lib/openfoodfacts'
import { toApiError } from '@/lib/apiError'
import { setReview } from '@/lib/reviewStore'
import type { Meal } from '@/db/types'
import { defaultMeal } from '@/lib/meal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

// BarcodeDetector ist (noch) nicht in den TS-DOM-Typen.
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

/** Nach Fehltreffer denselben Code kurz ignorieren, sonst feuert der Scan-Loop im Sekundentakt. */
const RESCAN_COOLDOWN_MS = 4000

export function Barcode() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const meal = (params.get('meal') as Meal) || defaultMeal()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  // i18n-Key der Meldung (capture.notFound oder errors.*), nie ein roher Fehlertext.
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
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

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <button onClick={() => navigate(-1)} aria-label={t('common.back')} className="text-muted-foreground">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-2xl font-bold">{t('capture.barcodeTitle')}</h1>
      </header>

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
