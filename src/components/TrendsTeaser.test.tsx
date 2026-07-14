import 'fake-indexeddb/auto'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { addMeasurement, createFood, logFood } from '@/db/repo'
import { TrendsTeaser } from './TrendsTeaser'

/**
 * Leichter UI-Test für den Verlauf-Teaser auf „Heute": rendert nichts ohne
 * ausreichende Daten, zeigt die Ø-kcal- bzw. Gewichts-Variante und verlinkt
 * als ganze Karte auf /trends.
 */

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }
const TODAY = '2026-07-10'

async function logOn(date: string) {
  const food = await createFood({ name: 'Reis', ...base })
  // 250 g à 100 kcal/100 g → 250 kcal pro Tag.
  await logFood({ food, date, meal: 'lunch', amount: 250, unit: 'g' })
}

describe('TrendsTeaser', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('rendert nichts ohne ausreichende Daten (nur 2 Log-Tage, kein Gewicht)', async () => {
    await logOn('2026-07-09')
    await logOn(TODAY)

    render(
      <MemoryRouter>
        <TrendsTeaser today={TODAY} />
      </MemoryRouter>,
    )

    // useLiveQuery auflösen lassen — auch danach darf kein Teaser erscheinen.
    await act(() => new Promise((r) => setTimeout(r, 80)))
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('zeigt die Ø-kcal-Variante ab 3 Log-Tagen und verlinkt zu /trends', async () => {
    await logOn('2026-07-08')
    await logOn('2026-07-09')
    await logOn(TODAY)

    render(
      <MemoryRouter>
        <TrendsTeaser today={TODAY} />
      </MemoryRouter>,
    )

    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/trends')
    expect(link.textContent).toContain('Ø 250 kcal in 7 Tagen')
  })

  it('zeigt ab 2 Gewichts-Messwerten Wert + Wochentrend mit Sparkline', async () => {
    await addMeasurement('weight', 82, 'kg', '2026-07-01')
    await addMeasurement('weight', 81.3, 'kg', '2026-07-08')

    render(
      <MemoryRouter>
        <TrendsTeaser today={TODAY} />
      </MemoryRouter>,
    )

    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/trends')
    // Aktueller Wert (de-Format) + Wochentrend: −0,7 kg über 7 Tage.
    expect(link.textContent).toContain('81,3 kg')
    expect(link.textContent).toContain('0,7 kg/Woche')
    expect(link.querySelector('polyline')).not.toBeNull()
  })
})
