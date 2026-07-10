import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { createFood, setPantry } from '@/db/repo'
import { setExpiry } from '@/lib/pantryStock'
import { ExpiryHint } from './ExpiryHint'

/**
 * Leichter UI-Test für die Ablauf-Hinweiszeile auf „Heute": Anzahl + Link zum
 * Einkauf. Die Fenster-Logik selbst ist in pantryStock.test.ts abgedeckt.
 */

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }

describe('ExpiryHint', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('zeigt die Anzahl bald ablaufender Artikel und verlinkt zum Einkauf', async () => {
    const food = await createFood({ name: 'Joghurt', ...base })
    await setPantry(food.id, true)
    await setExpiry(food.id, '2026-07-12')

    render(
      <MemoryRouter>
        <ExpiryHint today="2026-07-10" />
      </MemoryRouter>,
    )

    const link = await screen.findByRole('link')
    expect(link.textContent).toContain('1 Artikel läuft bald ab')
    expect(link.getAttribute('href')).toBe('/pantry')
  })
})
