import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'

/**
 * Dezenter Banner, sobald eine neue Service-Worker-Version bereitsteht
 * (registerType: 'prompt'). Die Registrierung passiert in main.tsx; sie meldet
 * sich hier über notifySwUpdate(), damit dieser Baustein ohne das virtuelle
 * PWA-Modul auskommt (und damit in Tests importierbar bleibt).
 */

type Listener = () => void

let needRefresh = false
let applyUpdate: (() => Promise<void>) | null = null
const listeners = new Set<Listener>()

/** Von main.tsx aufgerufen, wenn der SW ein Update bereithält. */
export function notifySwUpdate(update: () => Promise<void>) {
  applyUpdate = update
  needRefresh = true
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return needRefresh
}

function dismiss() {
  needRefresh = false
  listeners.forEach((l) => l())
}

export function UpdatePrompt() {
  const { t } = useTranslation()
  const visible = useSyncExternalStore(subscribe, getSnapshot)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
          style={{ width: 'calc(100% - 2rem)' }}
          role="status"
        >
          <span className="min-w-0 truncate">{t('pwa.updateAvailable')}</span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => void applyUpdate?.()}
              className="flex items-center gap-1 font-semibold text-background underline-offset-2 hover:underline"
            >
              <RefreshCw size={16} /> {t('pwa.reload')}
            </button>
            <button onClick={dismiss} aria-label={t('pwa.dismiss')} className="text-background/70 hover:text-background">
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
