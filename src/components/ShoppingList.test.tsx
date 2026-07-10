import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { OverlaysContext } from '@/lib/overlays-context'
import { addShoppingItem } from '@/lib/shopping'
import { ShoppingList } from './ShoppingList'

/**
 * Leichter UI-Test für den Einkaufslisten-Abschnitt: manuell hinzufügen und
 * Abhaken mit Undo-Toast. Die Repo-Logik selbst ist in shopping.test.ts abgedeckt.
 */

const showUndo = vi.fn()

function renderList() {
  return render(
    <OverlaysContext.Provider value={{ openCapture: () => {}, showUndo }}>
      <ShoppingList />
    </OverlaysContext.Provider>,
  )
}

describe('ShoppingList', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('zeigt den Leerzustand und legt Punkte über Input + Plus an', async () => {
    renderList()
    expect(await screen.findByText(/Einkaufsliste ist leer/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Artikel hinzufügen …'), { target: { value: 'Milch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    expect(await screen.findByText('Milch')).toBeTruthy()
    // Badge zählt offene Punkte.
    expect(screen.getByLabelText('1 offener Artikel').textContent).toBe('1')
  })

  it('Abhaken streicht den Punkt durch und bietet Undo an', async () => {
    await addShoppingItem({ name: 'Brot' })
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: 'Brot abhaken' }))

    await waitFor(() => {
      const name = screen.getByText('Brot')
      expect(name.className).toContain('line-through')
    })
    // Ohne Katalog-Verknüpfung nur „abgehakt" (nichts wandert in den Vorrat).
    expect(showUndo).toHaveBeenCalledWith('Brot abgehakt', expect.any(Function))
    expect(screen.getByRole('button', { name: 'Liste leeren (abgehakte)' })).toBeTruthy()
  })
})
