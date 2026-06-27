import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Camera, Image as ImageIcon, Loader2, ChevronLeft } from 'lucide-react'
import { analyzeImage, type AnalyzeMode } from '@/lib/ai'
import { downscaleImage } from '@/lib/image'
import { setReview } from '@/lib/reviewStore'
import type { Meal } from '@/db/types'
import { defaultMeal } from '@/lib/meal'
import { Button } from '@/components/ui/Button'

export function Capture() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mode = (params.get('mode') as AnalyzeMode) || 'meal'
  const meal = (params.get('meal') as Meal) || defaultMeal()

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = mode === 'label' ? t('capture.labelTitle') : t('capture.mealTitle')
  const hint = mode === 'label' ? t('capture.hintLabel') : t('capture.hintMeal')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const base64 = await downscaleImage(file)
      const result = await analyzeImage(mode, base64, hint)
      setReview({ items: result.items, meal, source: 'ai' })
      navigate('/review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

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
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
            <Loader2 size={40} className="text-primary" />
          </motion.span>
          <p className="text-sm text-muted-foreground">{t('capture.analyzing')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{hint}</p>
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">{t('capture.error')}</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
            </div>
          )}
          <div className="grid gap-3">
            <Button onClick={() => cameraRef.current?.click()}>
              <Camera size={20} /> {t('capture.take')}
            </Button>
            <Button variant="secondary" onClick={() => galleryRef.current?.click()}>
              <ImageIcon size={20} /> {t('capture.choose')}
            </Button>
          </div>
        </>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  )
}
