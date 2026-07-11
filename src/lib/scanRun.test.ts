import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearScanRun,
  decrementScanRun,
  incrementScanRun,
  onScanRunChange,
  readScanRun,
  startScanRun,
} from './scanRun'

describe('scanRun (Einräum-Zähler, sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear())

  it('ohne Runde liefert readScanRun null', () => {
    expect(readScanRun()).toBeNull()
  })

  it('startScanRun beginnt bei 0 und setzt eine laufende Runde nicht zurück', () => {
    startScanRun()
    expect(readScanRun()).toBe(0)
    incrementScanRun()
    startScanRun() // erneutes Betreten von Capture darf den Stand nicht nullen
    expect(readScanRun()).toBe(1)
  })

  it('incrementScanRun startet implizit, zählt hoch und gibt den neuen Stand zurück', () => {
    expect(incrementScanRun()).toBe(1)
    expect(incrementScanRun()).toBe(2)
    expect(readScanRun()).toBe(2)
  })

  it('incrementScanRun zählt mehrere Produkte auf einmal (Review mit >1 Item)', () => {
    startScanRun()
    expect(incrementScanRun(3)).toBe(3)
    expect(readScanRun()).toBe(3)
  })

  it('clearScanRun beendet die Runde', () => {
    incrementScanRun()
    clearScanRun()
    expect(readScanRun()).toBeNull()
  })

  it('decrementScanRun zählt zurück (Undo von „Nur in den Vorrat"), nie unter 0', () => {
    incrementScanRun(3)
    expect(decrementScanRun()).toBe(2)
    expect(decrementScanRun(5)).toBe(0)
    expect(readScanRun()).toBe(0)
  })

  it('decrementScanRun ohne laufende Runde eröffnet KEINE neue', () => {
    expect(decrementScanRun()).toBeNull()
    expect(readScanRun()).toBeNull()
  })

  it('benachrichtigt Zuhörer bei jeder Änderung (Batch-Chip zählt live mit)', () => {
    const listener = vi.fn()
    const off = onScanRunChange(listener)
    incrementScanRun()
    expect(listener).toHaveBeenCalledTimes(1)
    decrementScanRun()
    expect(listener).toHaveBeenCalledTimes(2)
    clearScanRun()
    expect(listener).toHaveBeenCalledTimes(3)
    off()
    incrementScanRun()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('kaputte oder negative Speicherwerte gelten als keine Runde', () => {
    sessionStorage.setItem('nt-scan-run', 'quatsch')
    expect(readScanRun()).toBeNull()
    sessionStorage.setItem('nt-scan-run', '-2')
    expect(readScanRun()).toBeNull()
  })
})
