import 'fake-indexeddb/auto'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@/i18n'
import type { FoodItem, LogEntry } from '@/db/types'
import { EditLogSheet } from './EditLogSheet'

/**
 * Audit-Befund 9: Beim Einheitenwechsel muss die Menge plausibel mitwechseln
 * ("1 Portion" → g wird 100 g, nicht 1 g → 0 kcal). Die Heuristik selbst
 * (amountForUnitSwitch) ist in reviewFlow.test.ts abgedeckt — hier wird die
 * Anwendung im Sheet getestet.
 */

const food: FoodItem = {
  id: 'food-1',
  name: 'Haferflocken',
  source: 'manual',
  per: 'g',
  kcal: 370,
  protein: 13,
  carbs: 59,
  fat: 7,
  defaultPortion: { amount: 80, unit: 'g' },
  createdAt: 1,
  updatedAt: 1,
}

function entryWith(amount: number, unit: LogEntry['unit']): LogEntry {
  return {
    id: 'log-1',
    foodId: food.id,
    date: '2026-07-09',
    meal: 'breakfast',
    loggedAt: 1,
    amount,
    unit,
    computed: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    updatedAt: 1,
  }
}

function amountInput(): HTMLInputElement {
  return screen.getByLabelText('Menge') as HTMLInputElement
}

describe('EditLogSheet Einheitenwechsel', () => {
  it('Portion → g setzt eine plausible Grammmenge statt "1 g"', () => {
    render(<EditLogSheet entry={entryWith(1, 'portion')} food={food} onClose={() => {}} />)
    expect(amountInput().value).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'g' }))
    expect(amountInput().value).toBe('100')
  })

  it('g → Portion setzt eine plausible Portionszahl statt "150 Portionen"', () => {
    render(<EditLogSheet entry={entryWith(150, 'g')} food={food} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Portion' }))
    expect(amountInput().value).toBe('1')
  })

  it('erneuter Klick auf die aktive Einheit lässt die Menge unangetastet', () => {
    render(<EditLogSheet entry={entryWith(150, 'g')} food={food} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'g' }))
    expect(amountInput().value).toBe('150')
  })
})
