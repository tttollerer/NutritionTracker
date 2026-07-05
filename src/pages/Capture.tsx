import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, Image as ImageIcon, ChevronLeft, ShieldCheck, Mic, Sparkles, RotateCcw } from 'lucide-react'
import { analyzeImage, type AnalyzeMode } from '@/lib/ai'
import { toApiError } from '@/lib/apiError'
import { downscaleImage } from '@/lib/image'
import { setReview } from '@/lib/reviewStore'
import { getSettings, updateSettings } from '@/db/repo'
import { useSpeechRecognition } from '@/lib/speech'
import type { Meal } from '@/db/types'
import { defaultMeal } from '@/lib/meal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'

export function Capture() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mode = (params.get('mode') as AnalyzeMode) || 'meal'
  const meal = (params.get('meal') as Meal) || defaultMeal()

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // i18n-Key des gemappten Fehlers (errors.*), nie ein roher Fehlertext.
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null) // verkleinertes Bild, noch nicht gesendet
  const [hint, setHint] = useState('')
  const consent = useLiveQuery(async () => (await getSettings()).photoConsent ?? false, [])

  // Speech-to-Text füllt das Beschreibungsfeld (Hinweis ans Modell).
  const recog = useSpeechRecognition((text) => setHint((h) => (h ? `${h} ${text}` : text)))

  const title = mode === 'label' ? t('capture.labelTitle') : t('capture.mealTitle')
  const uiHint = mode === 'label' ? t('capture.hintLabel') : t('capture.hintMeal')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErrorKey(null)
    try {
      // Verkleinern + Vorschau zeigen — noch NICHT an die KI senden.
      setPreview(await downscaleImage(file))
    } catch (err) {
      setErrorKey(toApiError(err).i18nKey)
    }
  }

  async function analyze() {
    if (!preview) return
    setErrorKey(null)
    setBusy(true)
    try {
      const result = await analyzeImage(mode, preview, hint.trim() || undefined)
      // Foto nur beim Essens-Modus als Mahlzeitenfoto behalten (nicht bei Tabellen-Scans).
      setReview({ items: result.items, meal, source: 'ai', photo: mode === 'meal' ? preview : undefined })
      navigate('/review')
    } catch (err) {
      setErrorKey(toApiError(err).i18nKey)
    } finally {
      setBusy(false)
    }
  }

  function retake() {
    setPreview(null)
    setHint('')
    setErrorKey(null)
    if (recog.listening) recog.stop()
  }

  // Gemappter Fehlertext + bei Offline der Ausweg „manuell erfassen" (/add).
  const errorBox = errorKey && (
    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p className="font-medium text-destructive">{t('capture.error')}</p>
      <p className="text-muted-foreground">{t(errorKey)}</p>
      {errorKey === 'errors.offline' && (
        <Button variant="secondary" className="w-full" onClick={() => navigate('/add')}>
          {t('errors.manualFallback')}
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <button onClick={() => navigate(-1)} aria-label={t('common.back')} className="text-muted-foreground">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-2xl font-bold">{title}</h1>
      </header>

      {busy ? (
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <Spinner size={40} className="text-primary" />
          <p className="text-sm text-muted-foreground">{t('capture.analyzing')}</p>
        </div>
      ) : preview ? (
        /* ── Vorschau + Beschreibung (Text/Sprache) vor dem Senden ── */
        <div className="space-y-4">
          <img src={preview} alt="" className="max-h-72 w-full rounded-lg object-cover" />

          {errorBox}

          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">{t('capture.describe')}</label>
            <div className="flex items-center gap-2">
              <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder={t('capture.describePh')} className="flex-1" />
              {recog.available && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => (recog.listening ? recog.stop() : recog.start())}
                  aria-label={t('coach.mic')}
                  className={cn(
                    'focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
                    recog.listening ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-foreground',
                  )}
                >
                  <Mic size={20} />
                </motion.button>
              )}
            </div>
            {recog.listening && <p className="mt-1 text-xs text-primary">{t('coach.listening')}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={retake}>
              <RotateCcw size={18} /> {t('capture.retake')}
            </Button>
            <Button onClick={analyze}>
              <Sparkles size={18} /> {t('capture.analyze')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{uiHint}</p>
          {errorBox}
          {consent === undefined ? (
            /* Consent noch nicht aus Dexie geladen → Skeleton statt leerem Aktionsbereich */
            <div className="grid gap-3" aria-hidden="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : consent === false ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck size={18} className="text-primary" /> {t('capture.consentTitle')}
              </p>
              <p className="text-sm text-muted-foreground">{t('capture.consentBody')}</p>
              <Button className="w-full" onClick={() => void updateSettings({ photoConsent: true })}>
                {t('capture.consentAccept')}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <Button onClick={() => cameraRef.current?.click()}>
                <Camera size={20} /> {t('capture.take')}
              </Button>
              <Button variant="secondary" onClick={() => galleryRef.current?.click()}>
                <ImageIcon size={20} /> {t('capture.choose')}
              </Button>
            </div>
          )}
        </>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  )
}
