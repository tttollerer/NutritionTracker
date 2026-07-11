import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { OverlaysContext } from '@/lib/overlays-context'
import { setReview, clearReview, type ReviewPayload } from '@/lib/reviewStore'
import { clearScanRun, incrementScanRun, readScanRun } from '@/lib/scanRun'
import { Review } from './Review'

/**
 * Review-Fixes am Einräum-Zähler (nt-scan-run): Abbruch auf der Review-Seite
 * (Tab-Leiste, Redirect) darf keinen Alt-Stand für die Session liegen lassen,
 * und das Undo von „Nur in den Vorrat" zählt den Zähler zurück.
 */

const showUndo = vi.fn()

function renderReview() {
  return render(
    <MemoryRouter>
      <OverlaysContext.Provider value={{ openCapture: () => {}, showUndo }}>
        <Review />
      </OverlaysContext.Provider>
    </MemoryRouter>,
  )
}

function payload(): ReviewPayload {
  return {
    items: [{ name: 'Skyr', amount: 100, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0 } }],
    meal: 'breakfast',
    source: 'ai',
  }
}

/** SPA-Navigation simulieren: Cleanups lesen window.location.pathname. */
function setPath(path: string) {
  window.history.replaceState({}, '', path)
}

describe('Review — Einräum-Zähler (Scan-Loop)', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    clearReview()
    clearScanRun()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  afterEach(() => setPath('/'))

  it('Abbruch über eine andere Route räumt den Zähler auf (kein Alt-Stand für die Session)', async () => {
    incrementScanRun(3)
    setReview(payload())
    setPath('/review')
    const { unmount } = renderReview()

    setPath('/pantry') // Nutzer tippt in der Tab-Leiste z. B. auf „Vorrat"
    unmount()
    expect(readScanRun()).toBeNull()
  })

  it('der Weg zurück in den Scan-Loop (/capture) erhält die laufende Runde', async () => {
    incrementScanRun(3)
    setReview(payload())
    setPath('/review')
    const { unmount } = renderReview()

    setPath('/capture?mode=label&batch=1')
    unmount()
    expect(readScanRun()).toBe(3)
  })

  it('Undo von „Nur in den Vorrat" zählt den Zähler zurück', async () => {
    setReview(payload())
    setPath('/review')
    renderReview()

    fireEvent.click(await screen.findByRole('button', { name: 'Nur in den Vorrat' }))
    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    expect(readScanRun()).toBe(1)

    // Undo aus dem Toast: Produkt raus aus dem Vorrat UND Zähler zurück.
    const undo = showUndo.mock.calls[0][1] as () => Promise<void>
    await act(() => undo())
    expect(readScanRun()).toBe(0)
    const food = (await db.foods.toArray())[0]
    expect(food.pantry).toBeUndefined()
  })
})
