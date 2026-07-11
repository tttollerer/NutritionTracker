import 'fake-indexeddb/auto'
import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { clearScanRun, incrementScanRun, readScanRun } from '@/lib/scanRun'
import { Capture } from './Capture'

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
