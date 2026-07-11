import { describe, expect, it } from 'vitest'
import { autoScanPath, parseScanIntent, routeAutoScan } from './scanRoute'

/**
 * Unified Scan: die komplette Routing-Matrix kind × intent → Ziel-Screen,
 * Primäraktion und Sonderfälle (Kassenbon ist immer Einkauf; Mahlzeitenfoto
 * bleibt nur beim Gericht erhalten).
 */

describe('parseScanIntent', () => {
  it('nur "buy" ist Einkauf — alles andere fällt auf "eat" zurück', () => {
    expect(parseScanIntent('buy')).toBe('buy')
    expect(parseScanIntent('eat')).toBe('eat')
    expect(parseScanIntent(null)).toBe('eat')
    expect(parseScanIntent(undefined)).toBe('eat')
    expect(parseScanIntent('BUY')).toBe('eat')
  })
})

describe('routeAutoScan — Matrix kind × intent', () => {
  it('meal: Review; Primäraktion folgt dem Intent, Foto bleibt Mahlzeitenfoto', () => {
    expect(routeAutoScan('meal', 'eat')).toEqual({ screen: 'review', primary: 'log', keepPhoto: true, receiptNotice: false })
    expect(routeAutoScan('meal', 'buy')).toEqual({ screen: 'review', primary: 'pantry', keepPhoto: true, receiptNotice: false })
  })

  it('label/barcode: Review ohne Mahlzeitenfoto; Primäraktion folgt dem Intent', () => {
    for (const kind of ['label', 'barcode'] as const) {
      expect(routeAutoScan(kind, 'eat')).toEqual({ screen: 'review', primary: 'log', keepPhoto: false, receiptNotice: false })
      expect(routeAutoScan(kind, 'buy')).toEqual({ screen: 'review', primary: 'pantry', keepPhoto: false, receiptNotice: false })
    }
  })

  it('receipt: IMMER ReceiptReview/Vorrat — bei Intent "eat" mit Hinweis', () => {
    expect(routeAutoScan('receipt', 'buy')).toEqual({ screen: 'receipt', primary: 'pantry', keepPhoto: false, receiptNotice: false })
    expect(routeAutoScan('receipt', 'eat')).toEqual({ screen: 'receipt', primary: 'pantry', keepPhoto: false, receiptNotice: true })
  })
})

describe('autoScanPath — Navigationsziele', () => {
  it('bildet die Query-Konventionen der Prüf-Screens ab', () => {
    expect(autoScanPath('meal', 'eat')).toBe('/review')
    expect(autoScanPath('meal', 'buy')).toBe('/review?primary=pantry')
    expect(autoScanPath('label', 'eat')).toBe('/review')
    expect(autoScanPath('label', 'buy')).toBe('/review?primary=pantry')
    expect(autoScanPath('barcode', 'buy')).toBe('/review?primary=pantry')
    expect(autoScanPath('receipt', 'buy')).toBe('/receipt')
    expect(autoScanPath('receipt', 'eat')).toBe('/receipt?from=eat')
  })
})
