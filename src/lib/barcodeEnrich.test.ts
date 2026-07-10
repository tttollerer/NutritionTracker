import { describe, expect, it } from 'vitest'
import { mergeOffIntoAnalyze } from './barcodeEnrich'
import type { AiResult } from './ai'
import type { OffProduct } from './openfoodfacts'

const aiResult: AiResult = {
  items: [
    {
      name: 'Helles Bier',
      amount: 500,
      unit: 'ml',
      confidence: 0.6,
      per100: { kcal: 45, protein: 0.4, carbs: 3.5, fat: 0 },
    },
  ],
  notes: 'Dose, Menge geschätzt',
  barcode: '4066600203704',
}

const off: OffProduct = {
  food: {
    name: 'Wulle Vollbier Hell',
    per: 'ml',
    kcal: 42,
    protein: 0.5,
    carbs: 3,
    fat: 0,
    micros: { sodium: 5 },
    source: 'openfoodfacts',
    barcode: '4066600203704',
  },
  allergens: ['gluten'],
  traces: [],
  packageSize: 500,
}

describe('mergeOffIntoAnalyze (Barcode-Anreicherung v1.4)', () => {
  it('Datenbankwerte schlagen die KI-Schätzung, die MENGE bleibt erhalten', () => {
    const merged = mergeOffIntoAnalyze(aiResult, off)
    expect(merged.source).toBe('openfoodfacts')
    expect(merged.barcode).toBe('4066600203704')
    expect(merged.items[0].name).toBe('Wulle Vollbier Hell')
    expect(merged.items[0].amount).toBe(500) // KI hat das Foto gesehen, OFF nicht
    expect(merged.items[0].per100).toEqual({ kcal: 42, protein: 0.5, carbs: 3, fat: 0, micros: { sodium: 5 } })
    expect(merged.items[0].confidence).toBe(1)
    expect(merged.allergens).toEqual(['gluten'])
    expect(merged.packageSize).toBe(500)
    expect(merged.notes).toBe('Dose, Menge geschätzt')
  })

  it('Mehr-Item-Mahlzeiten bleiben unangetastet (Zuordnung wäre mehrdeutig)', () => {
    const multi: AiResult = { ...aiResult, items: [aiResult.items[0], { ...aiResult.items[0], name: 'Brezel' }] }
    const merged = mergeOffIntoAnalyze(multi, off)
    expect(merged.source).toBe('ai')
    expect(merged.items).toHaveLength(2)
    expect(merged.items[0].name).toBe('Helles Bier')
  })

  it('leerer OFF-Name überschreibt den KI-Namen nicht', () => {
    const namelessOff: OffProduct = { ...off, food: { ...off.food, name: '' } }
    expect(mergeOffIntoAnalyze(aiResult, namelessOff).items[0].name).toBe('Helles Bier')
  })
})
