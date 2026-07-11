import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, Image as ImageIcon, ChevronLeft, ShieldCheck, Mic, Sparkles, RotateCcw } from 'lucide-react'
import { analyzeImage, analyzeReceipt, type AnalyzeMode } from '@/lib/ai'
import { enrichAnalyzeWithBarcode } from '@/lib/barcodeEnrich'
import { toApiError } from '@/lib/apiError'
import { downscaleImage } from '@/lib/image'
import { setReview } from '@/lib/reviewStore'
import { setReceiptDraft } from '@/lib/receipt'
import { peekPendingImage, clearPendingImage } from '@/lib/captureHandoff'
import { clearScanRun, readScanRun, startScanRun } from '@/lib/scanRun'
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
  // Scan-Loop beim Einräumen (Review „Nur in den Vorrat" → zurück hierher):
  // nur mit batch=1 aktiv — der normale Einzel-Scan bleibt unverändert.
  const batch = params.get('batch') === '1'

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // i18n-Key des gemappten Fehlers (errors.*), nie ein roher Fehlertext.
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // Direkt aus dem Quick-Sheet übergebenes Bild sofort als Vorschau übernehmen
  // (peek statt take — die Seiten-Transition mountet diese Seite kurz doppelt).
  const [preview, setPreview] = useState<string | null>(() => peekPendingImage())
  const [hint, setHint] = useState(() => params.get('hint') ?? '')
  const [runCount, setRunCount] = useState<number | null>(() => (batch ? readScanRun() : null))
  const consent = useLiveQuery(async () => (await getSettings()).photoConsent ?? false, [])

  // Batch-Runde beim Betreten sicherstellen und beim echten Verlassen beenden.
  // Der Transition-Doppelmount (siehe captureHandoff) und der Weg zur Analyse
  // (/review) zählen NICHT als Verlassen — dort läuft die Runde weiter.
  useEffect(() => {
    if (!batch) return
    startScanRun()
    setRunCount(readScanRun())
    return () => {
      const path = window.location.pathname
      if (path !== '/capture' && path !== '/review') clearScanRun()
    }
  }, [batch])

  // Speech-to-Text füllt das Beschreibungsfeld (Hinweis ans Modell).
  const recog = useSpeechRecognition((text) => setHint((h) => (h ? `${h} ${text}` : text)))

  const title =
    mode === 'label' ? t('capture.labelTitle') : mode === 'receipt' ? t('capture.receiptTitle') : t('capture.mealTitle')
  const uiHint =
    mode === 'label' ? t('capture.hintLabel') : mode === 'receipt' ? t('capture.hintReceipt') : t('capture.hintMeal')

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
    if (!preview || consent !== true) return
    setErrorKey(null)
    setBusy(true)
    try {
      const trimmedHint = hint.trim() || undefined
      // Kassenbon: eigenes Antwortschema + eigener Prüf-Screen (/receipt).
      if (mode === 'receipt') {
        const receipt = await analyzeReceipt(preview, trimmedHint)
        setReceiptDraft(receipt.items)
        clearPendingImage()
        navigate('/receipt')
        return
      }
      const result = await analyzeImage(mode, preview, trimmedHint)
      // Vertrag v1.4: Hat die KI einen Strichcode abgelesen, liefern die
      // exakten OFF-Daten Name/Nährwerte — die Mengen-Schätzung bleibt.
      const enriched = await enrichAnalyzeWithBarcode(result)
      // Foto nur beim Essens-Modus als Mahlzeitenfoto behalten (nicht bei Tabellen-Scans).
      // notes: freie Hinweise der KI (z. B. Unsicherheiten) — im Review anzeigen.
      // mode/hint/imageBase64/questions: Verfeinerungsschleife („Neu schätzen" im Review).
      setReview({
        items: enriched.items,
        meal,
        source: enriched.source,
        barcode: enriched.barcode,
        allergens: enriched.allergens,
        traces: enriched.traces,
        photo: mode === 'meal' ? preview : undefined,
        notes: enriched.notes,
        mode,
        hint: trimmedHint,
        imageBase64: preview,
        questions: enriched.questions,
      })
      clearPendingImage()
      navigate('/review')
    } catch (err) {
      setErrorKey(toApiError(err).i18nKey)
    } finally {
      setBusy(false)
    }
  }

  function retake() {
    clearPendingImage()
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
        {/* Zurück beendet die Batch-Runde explizit — auch wenn der History-Eintrag /review wäre. */}
        <button onClick={() => { clearPendingImage(); if (batch) clearScanRun(); navigate(-1) }} aria-label={t('common.back')} className="text-muted-foreground">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-2xl font-bold">{title}</h1>
      </header>

      {/* Batch-Zähler des Einräum-Loops: Tap auf „Fertig" beendet die Runde. */}
      {batch && runCount != null && (
        <button
          type="button"
          onClick={() => { clearScanRun(); navigate('/pantry') }}
          aria-label={t('capture.batchDoneAria', { count: runCount })}
          className="focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-primary-soft px-4 text-sm font-semibold text-primary"
        >
          {t('capture.batchCount', { count: runCount })}
          <span aria-hidden="true">·</span>
          {t('capture.batchDone')}
        </button>
      )}

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

          {/* Einmalige Foto-Datenschutz-Einwilligung vor dem ersten KI-Upload */}
          {consent === false && (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck size={18} className="text-primary" /> {t('capture.consentTitle')}
              </p>
              <p className="text-sm text-muted-foreground">{t('capture.consentBody')}</p>
              <Button className="w-full" onClick={() => void updateSettings({ photoConsent: true })}>
                {t('capture.consentAccept')}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={retake}>
              <RotateCcw size={18} /> {t('capture.retake')}
            </Button>
            <Button onClick={analyze} disabled={consent !== true}>
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
                <Camera size={20} /> {mode === 'receipt' ? t('capture.takeReceipt') : t('capture.take')}
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
