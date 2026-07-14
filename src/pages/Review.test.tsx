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

/**
 * Arbeitspaket „Review-Screen aufwerten": Live-Ergebnis je Position + Summe
 * (Menge × per100, dieselbe Rechnung wie die Buchung), sichtbare Mahlzeit-Chips
 * (vorher wurde payload.meal stumm verwendet) und Undo nach „Übernehmen".
 */
describe('Review — Live-Ergebnis, Mahlzeit-Chips & Undo nach „Übernehmen"', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    clearReview()
    clearScanRun()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  afterEach(() => setPath('/'))

  it('zeigt je Position das berechnete Ergebnis und darunter die Live-Summe', async () => {
    setReview(payload()) // Skyr, 100 g, 60 kcal / 10 g Eiweiß je 100 g
    setPath('/review')
    renderReview()

    expect(await screen.findByText('= 60 kcal')).toBeTruthy()
    expect(screen.getByText('Gesamt: 60 kcal · 10 g Eiweiß')).toBeTruthy()

    // Mengen-Änderung 100 → 200 g: Position UND Summe rechnen live mit.
    const amountInput = screen.getAllByRole('spinbutton')[0] // erstes Zahlenfeld = Menge
    fireEvent.change(amountInput, { target: { value: '200' } })
    expect(screen.getByText('= 120 kcal')).toBeTruthy()
    expect(screen.getByText('Gesamt: 120 kcal · 20 g Eiweiß')).toBeTruthy()
  })

  it('Mahlzeit-Chips: Vorauswahl aus payload.meal, Auswahl landet im Log-Eintrag', async () => {
    setReview(payload()) // meal: 'breakfast'
    setPath('/review')
    renderReview()

    const breakfast = await screen.findByRole('button', { name: 'Frühstück' })
    expect(breakfast.getAttribute('aria-pressed')).toBe('true')

    // Umschalten auf „Abend" und übernehmen → der Eintrag trägt die neue Mahlzeit.
    fireEvent.click(screen.getByRole('button', { name: 'Abend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    await waitFor(async () => expect(await db.logs.count()).toBe(1))
    const log = (await db.logs.toArray())[0]
    expect(log.meal).toBe('dinner')
  })

  it('nach „Übernehmen" erscheint ein Undo-Toast; Undo soft-deletet den Eintrag', async () => {
    setReview(payload())
    setPath('/review')
    renderReview()

    fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    expect(showUndo).toHaveBeenCalledWith('1 Eintrag geloggt', expect.any(Function))
    expect(await db.logs.count()).toBe(1)

    const undo = showUndo.mock.calls[0][1] as () => Promise<void>
    await act(() => undo())
    const log = (await db.logs.toArray())[0]
    expect(log.deletedAt).toBeTruthy()
  })

  it('mehrere Positionen: Plural-Label und Undo entfernt ALLE erzeugten Einträge', async () => {
    setReview({
      items: [
        { name: 'Skyr', amount: 100, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0 } },
        { name: 'Banane', amount: 120, unit: 'g', per100: { kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 } },
      ],
      meal: 'lunch',
      source: 'ai',
    })
    setPath('/review')
    renderReview()

    fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    expect(showUndo).toHaveBeenCalledWith('2 Einträge geloggt', expect.any(Function))
    expect(await db.logs.count()).toBe(2)

    const undo = showUndo.mock.calls[0][1] as () => Promise<void>
    await act(() => undo())
    const logs = await db.logs.toArray()
    expect(logs).toHaveLength(2)
    expect(logs.every((l) => l.deletedAt)).toBe(true)
  })
})
