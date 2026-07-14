import { describe, expect, it } from 'vitest'
import { checkAllergens, matchAllergens } from './allergens'
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

  it('covers the new EU allergens (celery, sesame, sulphites)', () => {
    expect(matchAllergens({ allergens: ['en:celery'] }, ['celery'])).toEqual(['celery'])
    expect(matchAllergens({ name: 'Tahini Paste' }, ['sesame'])).toEqual(['sesame'])
    expect(matchAllergens({ allergens: ['en:sulphur-dioxide-and-sulphites'] }, ['sulphites'])).toEqual(['sulphites'])
  })

  it('kurze Keywords matchen nur als ganzes Wort — kein Ei-Alarm bei Reis/Wein/Fleisch', () => {
    for (const name of ['Reis mit Gemüse', 'Weintrauben', 'Fleischpflanzerl', 'Eis am Stiel', 'Eintopf', 'Veggie-Burger']) {
      expect(matchAllergens({ name }, ['eggs'])).toEqual([])
    }
    expect(matchAllergens({ name: 'Ei, gekocht' }, ['eggs'])).toEqual(['eggs'])
    expect(matchAllergens({ name: 'Rührei mit Speck' }, ['eggs'])).toEqual(['eggs'])
    expect(matchAllergens({ name: 'Minutensteak' }, ['nuts'])).toEqual([])
    expect(matchAllergens({ name: 'Donut' }, ['nuts'])).toEqual([])
  })

  it('Wort-Präfix-Keywords: Eiersalat ja, Feierabendbier nein', () => {
    expect(matchAllergens({ name: 'Eiersalat' }, ['eggs'])).toEqual(['eggs'])
    expect(matchAllergens({ name: 'Feierabendbier' }, ['eggs'])).toEqual([])
  })

  it('Substring bleibt für deutsche Komposita erhalten', () => {
    expect(matchAllergens({ name: 'Vollmilchschokolade' }, ['lactose'])).toEqual(['lactose'])
    expect(matchAllergens({ name: 'Dinkelbrot' }, ['gluten'])).toEqual(['gluten'])
    expect(matchAllergens({ name: 'Haselnusscreme' }, ['nuts'])).toEqual(['nuts'])
  })

  it('„glutenfrei"/„laktosefrei" im Namen hebt den Keyword-Fallback auf', () => {
    expect(matchAllergens({ name: 'Glutenfreies Brot' }, ['gluten'])).toEqual([])
    expect(matchAllergens({ name: 'Laktosefreie Milch' }, ['lactose'])).toEqual([])
    // Strukturierte Tags bleiben die Primärquelle und werden NICHT negiert.
    expect(matchAllergens({ allergens: ['en:gluten'], name: 'Glutenfreies Brot' }, ['gluten'])).toEqual(['gluten'])
  })
})

describe('checkAllergens (Spuren vs. enthält)', () => {
  it('separates contains from traces', () => {
    const r = checkAllergens({ allergens: ['en:milk'], traces: ['en:nuts'] }, ['lactose', 'nuts'])
    expect(r.contains).toEqual(['lactose'])
    expect(r.traces).toEqual(['nuts'])
  })

  it('a direct hit is never also reported as a trace', () => {
    const r = checkAllergens({ allergens: ['en:peanuts'], traces: ['en:peanuts'] }, ['peanuts'])
    expect(r.contains).toEqual(['peanuts'])
    expect(r.traces).toEqual([])
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
