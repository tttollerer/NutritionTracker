import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { updateSettings } from '@/db/repo'
import { clearPendingImage, setPendingImage } from '@/lib/captureHandoff'
import { clearScanRun, incrementScanRun, readScanRun } from '@/lib/scanRun'
import { Capture } from './Capture'

// KI-Aufrufe mocken: die Auto-Analyse-Tests dürfen nie echte Requests auslösen.
const { analyzeAutoMock, analyzeImageMock } = vi.hoisted(() => ({
  analyzeAutoMock: vi.fn(),
  analyzeImageMock: vi.fn(),
}))
vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai')>()),
  analyzeAuto: analyzeAutoMock,
  analyzeImage: analyzeImageMock,
}))

/**
 * Review-Fix: der Einräum-Zähler (nt-scan-run) überlebt nur die Wege innerhalb
 * des Scan-Loops (/review, erneutes Batch-Capture) — jeder andere Abgang aus
 * dem Batch-Capture beendet die Runde, sonst zählt ein Alt-Stand später weiter.
 */

function renderBatchCapture() {
  return render(
    <MemoryRouter initialEntries={['/capture?mode=label&batch=1']}>
      <Capture />
    </MemoryRouter>,
  )
}

/** SPA-Navigation simulieren: der Unmount-Cleanup liest window.location. */
function setPath(path: string) {
  window.history.replaceState({}, '', path)
}

describe('Capture — Einräum-Zähler beim Verlassen', () => {
  beforeEach(async () => {
    clearScanRun()
    setPath('/capture?mode=label&batch=1')
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  afterEach(() => setPath('/'))

  it('Wechsel zu einem Nicht-Batch-Capture (Quick-Sheet-Foto) beendet die Runde', () => {
    const { unmount } = renderBatchCapture()
    act(() => void incrementScanRun(3)) // Chip zählt live mit (onScanRunChange)

    setPath('/capture?mode=meal&meal=dinner') // pathname bleibt /capture, aber ohne batch=1
    unmount()
    expect(readScanRun()).toBeNull()
  })

  it('die Wege im Loop (/review, Batch-Capture) erhalten die Runde', () => {
    const first = renderBatchCapture()
    act(() => void incrementScanRun(2))
    setPath('/review')
    first.unmount()
    expect(readScanRun()).toBe(2)

    // Transition-Doppelmount / Rückweg aus Review: erneutes Batch-Capture.
    setPath('/capture?mode=label&batch=1')
    const second = renderBatchCapture()
    second.unmount()
    expect(readScanRun()).toBe(2)
  })
})

/**
 * Arbeitspaket „Foto → Auto-Analyse": Kommt das Bild aus dem Quick-Sheet
 * (captureHandoff) und ist die Foto-Einwilligung bereits erteilt, startet die
 * Analyse ohne den Pflicht-Extra-Tap „Analysieren". Abbrechen führt zurück
 * zur Vorschau, das Ergebnis des abgebrochenen Laufs wird verworfen. Ohne
 * vorab erteilte Einwilligung bleibt der erste KI-Upload eine bewusste Aktion.
 */
describe('Capture — Auto-Analyse beim Handoff-Bild', () => {
  /** /review als Sonde: dort landet nur, wessen Analyse übernommen wurde. */
  function renderHandoffCapture() {
    return render(
      <MemoryRouter initialEntries={['/capture?mode=auto&intent=eat&meal=lunch']}>
        <Routes>
          <Route path="/capture" element={<Capture />} />
          <Route path="/review" element={<div data-testid="review-page" />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  const autoResult = {
    kind: 'meal',
    items: [{ name: 'Skyr', amount: 100, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0 } }],
  }

  // Jeder Test nutzt ein EIGENES Bild: der modulweite Doppelmount-Schutz in
  // Capture.tsx merkt sich gestartete Bilder auch über Testgrenzen hinweg.
  beforeEach(async () => {
    analyzeAutoMock.mockReset()
    analyzeImageMock.mockReset()
    clearPendingImage()
    setPath('/capture?mode=auto&intent=eat&meal=lunch')
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  afterEach(() => {
    clearPendingImage()
    setPath('/')
  })

  it('startet die Analyse automatisch (Handoff-Bild + erteilte Einwilligung) und navigiert zum Review', async () => {
    await updateSettings({ photoConsent: true })
    setPendingImage('data:image/jpeg;base64,auto-start')
    analyzeAutoMock.mockResolvedValue(autoResult)
    renderHandoffCapture()

    await waitFor(() => expect(analyzeAutoMock).toHaveBeenCalledTimes(1))
    expect(analyzeAutoMock).toHaveBeenCalledWith('data:image/jpeg;base64,auto-start', undefined)
    expect(await screen.findByTestId('review-page')).toBeInTheDocument()
  })

  it('der Transition-Doppelmount startet nur EINE Analyse', async () => {
    await updateSettings({ photoConsent: true })
    setPendingImage('data:image/jpeg;base64,doppelmount')
    analyzeAutoMock.mockResolvedValue(autoResult)

    // Flüchtige erste Instanz der Transition: mountet, Consent lädt bereits,
    // unmountet aber BEVOR der Start-Timer feuert — der Timer wird abgeräumt.
    const transient = renderHandoffCapture()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analysieren' })).toBeEnabled())
    transient.unmount()

    renderHandoffCapture() // bleibende Instanz startet genau einmal
    await screen.findByTestId('review-page')
    expect(analyzeAutoMock).toHaveBeenCalledTimes(1)
  })

  it('ohne vorab erteilte Einwilligung startet nichts automatisch — auch nicht direkt nach dem Zustimmen', async () => {
    setPendingImage('data:image/jpeg;base64,kein-consent')
    renderHandoffCapture()

    // Consent-Karte erscheint (photoConsent ist false) und wird angenommen …
    fireEvent.click(await screen.findByRole('button', { name: 'Verstanden & fortfahren' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analysieren' })).toBeEnabled())
    // … aber der erste KI-Upload bleibt eine bewusste Nutzer-Entscheidung
    // (400 ms > 250-ms-Start-Timer: ein Auto-Start hätte längst gefeuert).
    await act(() => new Promise<void>((r) => void setTimeout(r, 400)))
    expect(analyzeAutoMock).not.toHaveBeenCalled()
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('Abbrechen kehrt zur Vorschau zurück und ignoriert das späte Ergebnis', async () => {
    await updateSettings({ photoConsent: true })
    const img = 'data:image/jpeg;base64,abbrechen'
    setPendingImage(img)
    let resolveAnalyze!: (v: unknown) => void
    analyzeAutoMock.mockImplementation(() => new Promise((res) => (resolveAnalyze = res)))
    renderHandoffCapture()

    // Auto-Start läuft → Busy-Zustand mit Abbrechen-Ausweg.
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))

    // Zurück in der Vorschau: Bild, Beschreibungsfeld und manueller Start bleiben.
    expect(await screen.findByRole('button', { name: 'Analysieren' })).toBeInTheDocument()
    expect(screen.getByText('Beschreibung (optional)')).toBeInTheDocument()
    expect(document.querySelector('img')?.getAttribute('src')).toBe(img)

    // Das späte Ergebnis des abgebrochenen Laufs wird verworfen: keine Navigation.
    await act(async () => resolveAnalyze(autoResult))
    expect(screen.queryByTestId('review-page')).toBeNull()
    expect(screen.getByRole('button', { name: 'Analysieren' })).toBeInTheDocument()
  })
})
