import { beforeEach, describe, expect, it } from 'vitest'
import { clearScanRun, incrementScanRun, readScanRun, startScanRun } from './scanRun'

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

  it('kaputte oder negative Speicherwerte gelten als keine Runde', () => {
    sessionStorage.setItem('nt-scan-run', 'quatsch')
    expect(readScanRun()).toBeNull()
    sessionStorage.setItem('nt-scan-run', '-2')
    expect(readScanRun()).toBeNull()
  })
})
