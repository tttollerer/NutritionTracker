import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getReview, setReview, clearReview, type ReviewPayload } from './reviewStore'

const item = {
  name: 'Pommes',
  amount: 150,
  unit: 'g' as const,
  per100: { kcal: 290, protein: 3.5, carbs: 40, fat: 13 },
}

const payload: ReviewPayload = {
  items: [item],
  meal: 'lunch',
  source: 'ai',
  mode: 'meal',
  hint: 'mit Sauce',
  imageBase64: 'data:image/jpeg;base64,IMG',
  questions: ['Joghurtsauce oder Mayo?', 'Frittiert oder Ofen?'],
  photo: 'data:image/jpeg;base64,IMG',
}

/** setItem so mocken, dass Payloads mit den genannten Feldern am „Quota" scheitern. */
function failWhenContaining(...needles: string[]) {
  const original = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (needles.some((n) => value.includes(n))) throw new DOMException('quota', 'QuotaExceededError')
    original.call(this, key, value)
  })
}

describe('reviewStore (Verfeinerungs-Payload, Paket B)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Roundtrip mit Bild, Modus, Hint und Rückfragen', () => {
    setReview(payload)
    const loaded = getReview()
    expect(loaded).toEqual(payload)
    expect(loaded!.imageBase64).toBe('data:image/jpeg;base64,IMG')
    expect(loaded!.questions).toEqual(['Joghurtsauce oder Mayo?', 'Frittiert oder Ofen?'])

    clearReview()
    expect(getReview()).toBeNull()
  })

  it('Quota voll: imageBase64 wird verworfen, Items + Meta bleiben erhalten', () => {
    failWhenContaining('imageBase64')

    setReview(payload)
    const loaded = getReview()
    expect(loaded).not.toBeNull()
    expect(loaded!.imageBase64).toBeUndefined()
    expect(loaded!.items).toEqual(payload.items)
    expect(loaded!.photo).toBe(payload.photo)
    expect(loaded!.questions).toEqual(payload.questions)
  })

  it('Quota weiterhin voll: auch photo fällt weg, das Ergebnis geht nie verloren', () => {
    failWhenContaining('imageBase64', '"photo"')

    setReview(payload)
    const loaded = getReview()
    expect(loaded).not.toBeNull()
    expect(loaded!.imageBase64).toBeUndefined()
    expect(loaded!.photo).toBeUndefined()
    expect(loaded!.items).toEqual(payload.items)
    expect(loaded!.meal).toBe('lunch')
  })

  it('selbst der letzte Fallback wirft nicht (Payload bleibt dann einfach alt)', () => {
    failWhenContaining('Pommes')
    expect(() => setReview(payload)).not.toThrow()
  })
})
