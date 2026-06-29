import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Undo2 } from 'lucide-react'
import type { UndoState } from '@/lib/overlays-context'

/** Snackbar nach Ein-Tipp-Logs: „X hinzugefügt · Rückgängig" (auto-Ausblendung). */
export function UndoToast({ state, onDone }: { state: UndoState | null; onDone: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!state) return
    const timer = setTimeout(onDone, 5000)
    return () => clearTimeout(timer)
  }, [state, onDone])

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          key={state.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
          style={{ width: 'calc(100% - 2rem)' }}
          role="status"
        >
          <span className="min-w-0 truncate">{state.label}</span>
          <button
            onClick={async () => {
              await state.undo()
              onDone()
            }}
            className="flex shrink-0 items-center gap-1 font-semibold text-background underline-offset-2 hover:underline"
          >
            <Undo2 size={16} /> {t('common.undo')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
