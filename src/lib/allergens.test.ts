import { describe, expect, it } from 'vitest'
import { matchAllergens } from './allergens'
import { completeSentences } from './speech'

describe('matchAllergens', () => {
  it('matches OFF allergen tags (primary source)', () => {
    expect(matchAllergens({ allergens: ['en:milk'], name: 'X' }, ['lactose'])).toEqual(['lactose'])
    expect(matchAllergens({ allergens: ['soybeans'], name: 'X' }, ['soy', 'gluten'])).toEqual(['soy'])
  })

  it('falls back to name keywords only without tags', () => {
    expect(matchAllergens({ name: 'Erdnussbutter' }, ['peanuts'])).toEqual(['peanuts'])
    // Mit strukturierten Tags wird der Name NICHT als Quelle genutzt.
    expect(matchAllergens({ allergens: ['en:milk'], name: 'Erdnussbutter' }, ['peanuts'])).toEqual([])
  })

  it('returns nothing when the user has no allergies', () => {
    expect(matchAllergens({ allergens: ['en:milk'] }, [])).toEqual([])
  })
})

describe('completeSentences', () => {
  it('extracts only completed sentences and reports consumed length', () => {
    const text = 'Hallo da. Iss mehr Eisen! Noch unfertig'
    const { sentences, consumed } = completeSentences(text, 0)
    expect(sentences).toEqual(['Hallo da.', 'Iss mehr Eisen!'])
    expect(text.slice(consumed)).toBe(' Noch unfertig')
  })
})
