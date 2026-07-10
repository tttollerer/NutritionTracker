import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Camera, ScanBarcode, PencilLine } from 'lucide-react'
import { useOverlays } from '@/lib/overlays-context'

/** Prominenter Erfass-Einstieg ganz oben auf „Heute" — 1 Tipp zum Quick-Sheet. */
export function CaptureCta() {
  const { t } = useTranslation()
  const { openCapture } = useOverlays()
  return (
    <motion.button
      whileTap={{ scale: 0.99 }}
      onClick={openCapture}
      className="focus-ring flex w-full items-center gap-4 rounded-lg bg-brand-gradient p-4 text-left text-primary-foreground shadow-glow"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Camera size={26} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t('capture.ctaTitle')}</span>
        <span className="block text-sm opacity-90">{t('capture.ctaHint')}</span>
      </span>
      <span className="flex shrink-0 gap-1.5 opacity-90">
        <ScanBarcode size={18} />
        <PencilLine size={18} />
      </span>
    </motion.button>
  )
}
