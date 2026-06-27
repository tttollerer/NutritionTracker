import type { AiItem } from './ai'
import type { Meal } from '@/db/types'

/**
 * Zwischenspeicher für den Prüf-Screen. In sessionStorage, damit das Ergebnis
 * einen Reload übersteht und nicht im Router-State verloren geht.
 */
export interface ReviewPayload {
  items: AiItem[]
  meal: Meal
  source: 'ai' | 'openfoodfacts'
  barcode?: string
}

const KEY = 'nt-review'

export function setReview(payload: ReviewPayload) {
  sessionStorage.setItem(KEY, JSON.stringify(payload))
}

export function getReview(): ReviewPayload | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReviewPayload
  } catch {
    return null
  }
}

export function clearReview() {
  sessionStorage.removeItem(KEY)
}
