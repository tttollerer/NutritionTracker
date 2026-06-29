import { useCallback, useRef, useState, type ReactNode } from 'react'
import { CaptureSheet } from '@/components/CaptureSheet'
import { UndoToast } from '@/components/UndoToast'
import { OverlaysContext, type UndoState } from './overlays-context'

/**
 * Globale Overlays über der App-Shell: das Erfass-Quick-Sheet (vom +-Button und
 * von der Heute-Kamera-Karte geöffnet) und die Undo-Snackbar nach Ein-Tipp-Logs.
 */
export function OverlaysProvider({ children }: { children: ReactNode }) {
  const [captureOpen, setCaptureOpen] = useState(false)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const idRef = useRef(0)

  const openCapture = useCallback(() => setCaptureOpen(true), [])
  const showUndo = useCallback((label: string, undoFn: () => void | Promise<void>) => {
    idRef.current += 1
    setUndo({ label, undo: undoFn, id: idRef.current })
  }, [])

  return (
    <OverlaysContext.Provider value={{ openCapture, showUndo }}>
      {children}
      <CaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} showUndo={showUndo} />
      <UndoToast state={undo} onDone={() => setUndo(null)} />
    </OverlaysContext.Provider>
  )
}
