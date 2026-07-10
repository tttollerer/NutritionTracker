import 'fake-indexeddb/auto'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { createFood, setFoodPrice } from '@/db/repo'
import { createRecipe } from '@/lib/recipes'
import { OverlaysContext } from '@/lib/overlays-context'
import { Recipes } from './Recipes'

/**
 * Leichter UI-Test für die Rezeptliste: Leerzustand, Meta-Zeile (Portionen,
 * kcal & Kosten je Portion) und Löschen mit Undo-Toast. Die Rezept-Logik
 * selbst ist in src/lib/recipes.test.ts abgedeckt.
 */

const showUndo = vi.fn()

function renderPage() {
  return render(
    <MemoryRouter>
      <OverlaysContext.Provider value={{ openCapture: () => {}, showUndo }}>
        <Recipes />
      </OverlaysContext.Provider>
    </MemoryRouter>,
  )
}

describe('Recipes-Seite', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('zeigt den Leerzustand ohne Rezepte', async () => {
    renderPage()
    expect(await screen.findByText(/Noch keine Rezepte/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Neues Rezept/ })).toBeTruthy()
  })

  it('listet Rezepte mit Portionen, kcal und Kosten je Portion', async () => {
    const rice = await createFood({ name: 'Reis', per: 'g', kcal: 350, protein: 7, carbs: 70, fat: 1 })
    await setFoodPrice(rice.id, { amount: 2, per: 500 })
    await createRecipe({
      name: 'Reispfanne',
      portions: 4,
      ingredients: [{ foodId: rice.id, amount: 400, unit: 'g' }],
    })
    renderPage()

    expect(await screen.findByText('Reispfanne')).toBeTruthy()
    // 1400 kcal / 4 = 350 kcal; 400/500*2 € / 4 = 0,40 €.
    expect(screen.getByText(/4 Portionen · 350 kcal \/ Portion · 0,40\s?€ pro Portion · 1 Zutat/)).toBeTruthy()
  })

  it('Löschen setzt den Tombstone und bietet Undo an', async () => {
    await createRecipe({ name: 'Bowl', portions: 2, ingredients: [] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Bowl löschen' }))

    expect(await screen.findByText(/Noch keine Rezepte/)).toBeTruthy()
    expect(showUndo).toHaveBeenCalledWith('Rezept gelöscht', expect.any(Function))
  })
})
