import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import type { Meal } from '@/db/types'
import { createFood, toggleFavorite } from '@/db/repo'
import { OverlaysContext } from '@/lib/overlays-context'
import { todayKey } from '@/lib/utils'
import { Add } from './Add'

/**
 * Review-Fix: „Gestern kopieren" bleibt nach dem Kopieren auf der Seite —
 * ohne Doppel-Tap-Schutz würde ein zweiter Tap alle gestrigen Einträge
 * erneut kopieren und das Undo der ersten Charge im Toast ersetzen.
 */

const showUndo = vi.fn()

function renderAdd() {
  return render(
    <MemoryRouter>
      <OverlaysContext.Provider value={{ openCapture: () => {}, showUndo }}>
        <Add />
      </OverlaysContext.Provider>
    </MemoryRouter>,
  )
}

function dayKey(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return todayKey(d)
}

async function seedLog(foodId: string, date: string, meal: Meal) {
  await db.logs.put({
    id: crypto.randomUUID(),
    foodId,
    date,
    meal,
    loggedAt: Date.now(),
    amount: 100,
    unit: 'g',
    computed: { kcal: 100, protein: 5, carbs: 10, fat: 2 },
    updatedAt: Date.now(),
  })
}

describe('Add — Doppel-Tap-Schutz für „Gestern kopieren"', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Doppel-Tap kopiert die gestrige Mahlzeit nur EINMAL', async () => {
    const food = await createFood({ name: 'Reis', per: 'g', kcal: 130, protein: 3, carbs: 28, fat: 0 })
    await seedLog(food.id, dayKey(-1), 'breakfast')
    await seedLog(food.id, dayKey(-1), 'dinner')

    renderAdd()
    fireEvent.click(await screen.findByRole('button', { name: 'Frühstück' }))
    const copyBtn = await screen.findByRole('button', { name: /Frühstück von gestern kopieren/ })
    fireEvent.click(copyBtn)
    fireEvent.click(copyBtn) // zweiter Tap, bevor die erste Kopie fertig ist

    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    const todays = await db.logs.where('date').equals(dayKey(0)).toArray()
    expect(todays).toHaveLength(1) // 1 Kopie (Frühstück), keine Duplikate
  })
})

/**
 * Usability-Audit #9: „Menge von {{name}} per Foto schätzen" öffnet das
 * Mengen-Sheet des GEWÄHLTEN Produkts (Foto-Schätz-Flow im Sheet, Ergebnis
 * füllt das Mengenfeld) — statt nach /capture?mode=portion zu navigieren,
 * wo der Review per Namens-Match ein NEUES Food anlegte.
 */
describe('Add — „Menge per Foto schätzen" öffnet das Mengen-Sheet', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Tap öffnet das PortionSheet des richtigen Foods statt zu /capture zu navigieren', async () => {
    const food = await createFood({ name: 'Reis', per: 'g', kcal: 130, protein: 3, carbs: 28, fat: 0 })
    await toggleFavorite(food.id) // Zeile erscheint in der Favoriten-Sektion

    render(
      <MemoryRouter initialEntries={['/add']}>
        <OverlaysContext.Provider value={{ openCapture: () => {}, showUndo }}>
          <Routes>
            <Route path="/add" element={<Add />} />
            {/* Sonde: hier landet nur, wer doch noch zu /capture navigiert. */}
            <Route path="/capture" element={<div data-testid="capture-page" />} />
          </Routes>
        </OverlaysContext.Provider>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Menge von Reis per Foto schätzen' }))

    // Mengen-Sheet DIESES Produkts ist offen, die Erfassen-Seite bleibt stehen.
    expect(await screen.findByRole('dialog', { name: 'Menge von Reis wählen' })).toBeInTheDocument()
    expect(screen.queryByTestId('capture-page')).toBeNull()
    // Direkteinstieg Foto-Schätzung: ohne erteilte Einwilligung stößt
    // autoPhotoEstimate zuerst den Consent-Block an (statt der Kamera).
    expect(await screen.findByText('Foto an KI senden?')).toBeInTheDocument()
  })
})
