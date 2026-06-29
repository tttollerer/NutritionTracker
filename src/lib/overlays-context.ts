import { createContext, useContext } from 'react'

/** Context + Typen für die globalen Overlays (Quick-Sheet + Undo-Snackbar). */
export interface UndoState {
  label: string
  undo: () => void | Promise<void>
  id: number
}

export interface OverlaysApi {
  openCapture: () => void
  showUndo: (label: string, undo: () => void | Promise<void>) => void
}

export const OverlaysContext = createContext<OverlaysApi | null>(null)

export function useOverlays(): OverlaysApi {
  const c = useContext(OverlaysContext)
  if (!c) throw new Error('useOverlays muss innerhalb von OverlaysProvider genutzt werden')
  return c
}
