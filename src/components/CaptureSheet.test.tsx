import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import type { Meal } from '@/db/types'
import { createFood } from '@/db/repo'
import { setPantryQty } from '@/lib/pantryStock'
import { todayKey } from '@/lib/utils'
import { CaptureSheet } from './CaptureSheet'

/**
 * Review-Fixes im Quick-Sheet: Doppel-Tap-Schutz für „N eintragen" und
 * „{Mahlzeit} wie gestern" (sonst doppelte Logs + doppelter Bestand-Abzug,
 * und nur die zweite Charge wäre undo-bar) sowie die Mehrfach-Auswahl, die
 * beim Mahlzeit-Wechsel keine gewählten Produkte verlieren darf.
 */

const showUndo = vi.fn()
const onClose = vi.fn()

function renderSheet() {
  return render(
    <MemoryRouter>
      <CaptureSheet open onClose={onClose} showUndo={showUndo} />
    </MemoryRouter>,
  )
}

const base = { per: 'g' as const, kcal: 200, protein: 10, carbs: 20, fat: 5 }

function dayKey(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return todayKey(d)
}

async function seedLog(foodId: string, date: string, meal: Meal, kcal = 100) {
  await db.logs.put({
    id: crypto.randomUUID(),
    foodId,
    date,
    meal,
    loggedAt: Date.now(),
    amount: 100,
    unit: 'g',
    computed: { kcal, protein: 0, carbs: 0, fat: 0 },
    updatedAt: Date.now(),
  })
}

describe('CaptureSheet — Unified Scan (EIN Hero + Intent-Toggle)', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    onClose.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('zeigt EINEN Scan-Hero, den Intent-Toggle (Default „Gegessen") und keine Alt-Kacheln', async () => {
    renderSheet()
    expect(await screen.findByRole('button', { name: /die KI erkennt's/ })).toBeTruthy()

    const eat = screen.getByRole('button', { name: 'Gegessen' })
    const buy = screen.getByRole('button', { name: 'Eingekauft' })
    expect(eat.getAttribute('aria-pressed')).toBe('true')
    expect(buy.getAttribute('aria-pressed')).toBe('false')
    expect(eat.className).toContain('min-h-[48px]')

    // Die alten Einstiege sind durch den Unified Scan abgedeckt.
    expect(screen.queryByRole('button', { name: 'Produkt scannen' })).toBeNull()
    expect(screen.queryByText('Einkauf scannen → Vorrat')).toBeNull()
    // Erhalten: Manuell, Rezepte-Link und der Live-Barcode-Sekundärlink.
    expect(screen.getByRole('button', { name: /Manuell/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rezept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Barcode scannen' })).toBeTruthy()
  })

  it('„Eingekauft" dimmt die Mahlzeit-Chips, entfernt sie aber nicht (Layout stabil)', async () => {
    renderSheet()
    const breakfast = await screen.findByRole('button', { name: 'Frühstück' })
    const chipsWrap = breakfast.parentElement!
    expect(chipsWrap.className).not.toContain('opacity-40')

    fireEvent.click(screen.getByRole('button', { name: 'Eingekauft' }))
    expect(screen.getByRole('button', { name: 'Eingekauft' }).getAttribute('aria-pressed')).toBe('true')
    expect(chipsWrap.className).toContain('opacity-40')
    expect(screen.getByRole('button', { name: 'Frühstück' })).toBeTruthy() // noch da
  })
})

describe('CaptureSheet — Doppel-Tap-Schutz & Mehrfach-Auswahl', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    onClose.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Doppel-Tap auf „N eintragen" loggt nur EINMAL und zieht den Bestand nur einmal ab', async () => {
    const a = await createFood({ name: 'Nudeln', ...base })
    const b = await createFood({ name: 'Pesto', ...base })
    await setPantryQty(a.id, 3)
    await setPantryQty(b.id, 3)

    renderSheet()
    fireEvent.click(await screen.findByRole('button', { name: 'Mehrere wählen' }))
    fireEvent.click(await screen.findByLabelText('Nudeln auswählen'))
    fireEvent.click(await screen.findByLabelText('Pesto auswählen'))

    const footer = screen.getByRole('button', { name: /2 eintragen/ })
    fireEvent.click(footer)
    fireEvent.click(footer) // zweiter Tap, bevor der erste Batch fertig ist

    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    expect(await db.logs.count()).toBe(2)
    expect((await db.foods.get(a.id))!.pantryQty).toBe(2)
    expect((await db.foods.get(b.id))!.pantryQty).toBe(2)

    // Auch nach Abschluss bleibt der Button bis zum nächsten Öffnen gesperrt
    // (das Sheet ist während der Exit-Animation weiter tappbar).
    fireEvent.click(footer)
    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    expect(await db.logs.count()).toBe(2)
  })

  it('Doppel-Tap auf „wie gestern" kopiert die gestrige Mahlzeit nur EINMAL', async () => {
    const food = await createFood({ name: 'Skyr', ...base })
    await seedLog(food.id, dayKey(-1), 'breakfast', 176)
    await seedLog(food.id, dayKey(-1), 'breakfast', 176)

    renderSheet()
    fireEvent.click(await screen.findByRole('button', { name: 'Frühstück' }))
    const chip = await screen.findByRole('button', { name: /wie gestern/ })
    fireEvent.click(chip)
    fireEvent.click(chip)

    await waitFor(() => expect(showUndo).toHaveBeenCalledTimes(1))
    const todays = await db.logs.where('date').equals(dayKey(0)).toArray()
    expect(todays).toHaveLength(2) // 2 Kopien, nicht 4
  })

  it('Mahlzeit-Wechsel wirft ein gewähltes Produkt NICHT aus Auswahl und Anzeige', async () => {
    // 9 Vorrats-Produkte: „Overnight Oats" ist ohne Affinität das älteste
    // (Rang 9, fiele aus den Top 8), hat aber Frühstücks-Affinität.
    const oats = await createFood({ name: 'Overnight Oats', ...base })
    await setPantryQty(oats.id, 1)
    await db.foods.update(oats.id, { updatedAt: 1 })
    for (let i = 0; i < 8; i++) {
      const f = await createFood({ name: `Produkt ${i + 1}`, ...base })
      await setPantryQty(f.id, 1)
      await db.foods.update(f.id, { updatedAt: 100 + i })
    }
    await seedLog(oats.id, dayKey(0), 'breakfast')
    await seedLog(oats.id, dayKey(-1), 'breakfast')

    renderSheet()
    const toggle = await screen.findByRole('button', { name: 'Mehrere wählen' })
    expect(toggle.className).toContain('min-h-[48px]') // 48-px-Tap-Target
    fireEvent.click(screen.getByRole('button', { name: 'Frühstück' }))
    fireEvent.click(toggle)
    fireEvent.click(await screen.findByLabelText('Overnight Oats auswählen'))
    expect(screen.getByRole('button', { name: /1 eintragen/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Abend' }))

    // Trotz Affinitäts-Resort (Rang > 8) bleibt das gewählte Produkt sichtbar,
    // ausgewählt und im Footer gezählt — statt still aus dem Log zu fallen.
    const chip = await screen.findByLabelText('Overnight Oats auswählen')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /1 eintragen/ })).toBeTruthy()
  })
})
