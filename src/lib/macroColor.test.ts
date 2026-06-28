import { describe, expect, it } from 'vitest'
import { macroColor } from './macroColor'

describe('macroColor', () => {
  it('mappt jeden Makro-Key auf seine Token-Klasse', () => {
    expect(macroColor('protein')).toBe('bg-protein')
    expect(macroColor('carbs')).toBe('bg-carbs')
    expect(macroColor('fat')).toBe('bg-fat')
  })
})
