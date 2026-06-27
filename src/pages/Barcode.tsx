import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { lookupBarcode } from '@/lib/openfoodfacts'
import { setReview } from '@/lib/reviewStore'
import type { Meal } from '@/db/types'
import { defaultMeal } from '@/lib/meal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// BarcodeDetector ist (noch) nicht in den TS-DOM-Typen.
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

export function Barcode() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const meal = (params.get('meal') as Meal) || defaultMeal()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

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
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes[0]?.rawValue) {
              stopped = true
              void handleCode(codes[0].rawValue)
              return
            }
          } catch {
            /* einzelne Frames können fehlschlagen */
          }
          raf = requestAnimationFrame(tick)
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
    setBusy(true)
    setError(null)
    try {
      const product = await lookupBarcode(code.trim())
      if (!product) {
        setError(t('capture.notFound'))
        setBusy(false)
        return
      }
      setReview({
        items: [
          {
            name: product.food.name,
            amount: 100,
            unit: 'g',
            per100: {
              kcal: product.food.kcal,
              protein: product.food.protein,
              carbs: product.food.carbs,
              fat: product.food.fat,
            },
          },
        ],
        meal,
        source: 'openfoodfacts',
        barcode: code.trim(),
      })
      navigate('/review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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

      <div className="overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
      </div>

      {!scanning && <p className="text-sm text-muted-foreground">{t('capture.noCamera')}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Input
          inputMode="numeric"
          placeholder={t('capture.manualBarcode')}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <Button className="w-full" disabled={!manual.trim() || busy} onClick={() => handleCode(manual)}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : t('capture.scan')}
        </Button>
      </div>
    </div>
  )
}
