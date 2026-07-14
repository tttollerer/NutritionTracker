import { describe, expect, it } from 'vitest'
import { describePortion, gramsFromPortionResult, portionPhotoHint } from './portion'
import type { AnalyzeItem } from './apiContract'

const item = (over: Partial<AnalyzeItem> = {}): AnalyzeItem => ({
  name: 'Whey Protein Powder',
  amount: 32.4,
  unit: 'g',
  per100: { kcal: 380, protein: 78, carbs: 6, fat: 5 },
  ...over,
})

describe('describePortion', () => {
  it('mit Label „1 Tasse (80 g)", ohne Label nur die Menge', () => {
    expect(describePortion({ amount: 80, unit: 'g', label: 'Tasse' })).toBe('1 Tasse (80 g)')
    expect(describePortion({ amount: 80, unit: 'g' })).toBe('80 g')
  })
})

describe('portionPhotoHint (Mengenschätzung per Foto)', () => {
  it('Produktname + Einheit als Kontext („im Messbecher"-Fall)', () => {
    expect(portionPhotoHint('Whey Protein Powder', 'Kappe')).toBe(
      'Whey Protein Powder. Menge in: Kappe',
    )
  })

  it('ohne Einheit nur der (getrimmte) Name; leer → undefined', () => {
    expect(portionPhotoHint('  Skyr ')).toBe('Skyr')
    expect(portionPhotoHint('Skyr', '   ')).toBe('Skyr')
    expect(portionPhotoHint('   ')).toBeUndefined()
  })

  it('respektiert das Server-Limit von 280 Zeichen', () => {
    const hint = portionPhotoHint('x'.repeat(300), 'Kappe')
    expect(hint).toHaveLength(280)
  })
})

describe('gramsFromPortionResult', () => {
  it('erstes Item → gerundete Basis-Menge', () => {
    expect(gramsFromPortionResult({ items: [item()] })).toBe(32)
    expect(gramsFromPortionResult({ items: [item({ amount: 45.5, unit: 'ml' })] })).toBe(46)
  })

  it('null bei leerem Ergebnis, unit=portion oder Menge ≤ 0', () => {
    expect(gramsFromPortionResult({ items: [] })).toBeNull()
    expect(gramsFromPortionResult({ items: [item({ unit: 'portion' })] })).toBeNull()
    expect(gramsFromPortionResult({ items: [item({ amount: 0 })] })).toBeNull()
    expect(gramsFromPortionResult({ items: [item({ amount: 0.2 })] })).toBeNull()
  })
})
