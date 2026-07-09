import { describe, expect, it } from 'vitest'
import { inferPer, mapProduct } from './openfoodfacts'
import { AiResult } from './ai'

describe('mapProduct', () => {
  it('maps OFF nutriments to a food per 100 g', () => {
    const r = mapProduct('40111', {
      product_name: 'Nutella',
      nutriments: {
        'energy-kcal_100g': 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        fat_100g: 30.9,
      },
      allergens_tags: ['en:milk', 'en:nuts'],
    })
    expect(r).not.toBeNull()
    expect(r!.food.name).toBe('Nutella')
    expect(r!.food.kcal).toBe(539)
    expect(r!.food.barcode).toBe('40111')
    expect(r!.allergens).toEqual(['milk', 'nuts'])
  })

  it('returns null when there is no name and no energy', () => {
    expect(mapProduct('x', { nutriments: {} })).toBeNull()
  })

  it('führt Getränke als ml und Festes als g (Audit-Befund 15)', () => {
    const cola = mapProduct('5449000000996', {
      product_name: 'Coca-Cola',
      nutriments: { 'energy-kcal_100g': 42 },
      product_quantity: '330',
      product_quantity_unit: 'ml',
      categories_tags: ['en:beverages', 'en:carbonated-drinks', 'en:sodas'],
    })
    expect(cola!.food.per).toBe('ml')

    const schoko = mapProduct('40111', {
      product_name: 'Schokolade',
      nutriments: { 'energy-kcal_100g': 539 },
      product_quantity: 100,
      product_quantity_unit: 'g',
      categories_tags: ['en:snacks', 'en:chocolates'],
    })
    expect(schoko!.food.per).toBe('g')
  })
})

describe('inferPer', () => {
  it('explizite Packungs-Einheit gewinnt', () => {
    expect(inferPer({ product_quantity_unit: 'ml' })).toBe('ml')
    expect(inferPer({ product_quantity_unit: 'L' })).toBe('ml')
    expect(inferPer({ product_quantity_unit: 'g', categories_tags: ['en:beverages'] })).toBe('g')
  })

  it('liest die Portionsangabe (serving_size)', () => {
    expect(inferPer({ serving_size: '330 ml' })).toBe('ml')
    expect(inferPer({ serving_size: '25 cl' })).toBe('ml')
    expect(inferPer({ serving_size: '2 Stück (25 g)' })).toBe('g')
  })

  it('erkennt Getränke-Kategorien, aber nicht die Sammelkategorie', () => {
    expect(inferPer({ categories_tags: ['en:beverages'] })).toBe('ml')
    expect(inferPer({ categories_tags: ['en:carbonated-drinks'] })).toBe('ml')
    expect(inferPer({ categories_tags: ['en:fruit-juices'] })).toBe('ml')
    // Sammelkategorie enthält auch feste Lebensmittel → kein Getränke-Signal.
    expect(inferPer({ categories_tags: ['en:plant-based-foods-and-beverages', 'en:tofus'] })).toBe('g')
  })

  it('fällt ohne Signal auf g zurück', () => {
    expect(inferPer({})).toBe('g')
    expect(inferPer({ categories_tags: ['en:chocolates'] })).toBe('g')
  })
})

describe('AiResult schema', () => {
  it('accepts a valid result', () => {
    const r = AiResult.parse({
      items: [{ name: 'Apfel', amount: 150, unit: 'g', confidence: 0.8, per100: { kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 } }],
    })
    expect(r.items).toHaveLength(1)
  })

  it('rejects an invalid unit', () => {
    expect(() =>
      AiResult.parse({ items: [{ name: 'X', amount: 1, unit: 'kg', per100: { kcal: 1, protein: 1, carbs: 1, fat: 1 } }] }),
    ).toThrow()
  })
})
