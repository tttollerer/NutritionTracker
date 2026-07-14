import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { createFood } from '@/db/repo'
import { updateFoodValues } from '@/lib/foodEdit'
import type { FoodItem, LogEntry } from '@/db/types'
import { PortionSheet } from './PortionSheet'

/**
 * Nutzerfeedback Mengen-Sheet: benannte Einheiten („Kappe" = Messbecher)
 * müssen beim Eintragen korrekt in die Basis-Einheit umgerechnet werden,
 * und „+ Einheit" legt eine neue Einheit direkt im Verzehr-Moment an.
 */

const base = { per: 'g' as const, kcal: 380, protein: 78, carbs: 6, fat: 5 }

async function makeFood(servings?: { label: string; amount: number }[]): Promise<FoodItem> {
  const food = await createFood({ name: 'Whey Protein Powder', ...base })
  return servings ? updateFoodValues(food.id, { servings }) : food
}

function amountInput(): HTMLInputElement {
  return screen.getByLabelText('Menge') as HTMLInputElement
}

describe('PortionSheet — benannte Einheiten', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('rechnet „Kappe (30 g)" × 2 beim Eintragen in 60 g um (Basis-Menge + Snapshot)', async () => {
    const food = await makeFood([{ label: 'Kappe', amount: 30 }])
    const onLogged = vi.fn()
    render(<PortionSheet food={food} initialMeal="breakfast" onClose={() => {}} onLogged={onLogged} />)

    // Einheiten-Chip zeigt die Umrechnung an und ist per aria-pressed wählbar.
    const chip = await screen.findByRole('button', { name: 'Kappe (30 g)' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(amountInput(), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1))
    const entry = onLogged.mock.calls[0][0] as LogEntry
    expect(entry.amount).toBe(60)
    expect(entry.unit).toBe('g')
    expect(entry.serving).toEqual({ label: 'Kappe', count: 2 })

    const stored = await db.logs.get(entry.id)
    expect(stored?.amount).toBe(60)
  })

  it('„+ Einheit" mit Preset persistiert via foodEdit und ist sofort ausgewählt', async () => {
    const food = await makeFood()
    render(<PortionSheet food={food} initialMeal="lunch" onClose={() => {}} onLogged={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: '+ Einheit' }))
    // Preset „Esslöffel · 15 g" füllt Label + Gramm, Speichern legt die Einheit an.
    fireEvent.click(screen.getByRole('button', { name: 'Esslöffel · 15 g' }))
    fireEvent.click(screen.getByRole('button', { name: 'Einheit speichern' }))

    // Neue Einheit erscheint als Chip, ist direkt aktiv und Menge springt auf 1.
    const chip = await screen.findByRole('button', { name: 'Esslöffel (15 g)' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(amountInput().value).toBe('1')

    // Persistiert am Produkt (additiv über foodEdit).
    await waitFor(async () => {
      const stored = await db.foods.get(food.id)
      expect(stored?.servings).toEqual([{ label: 'Esslöffel', amount: 15 }])
    })
  })
})
