import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { createFood, setFoodPrice, setPantry } from '@/db/repo'
import { planFood } from '@/lib/planning'
import { OverlaysContext } from '@/lib/overlays-context'
import { todayKey } from '@/lib/utils'
import { Week } from './Week'

/**
 * Leichter UI-Test für die Vorausplanung im Wochenplaner: geplante Einträge
 * werden dezent gerendert und lassen sich bestätigen; der Vorrats-Picker plant
 * per Tipp. Die Repo-/Lib-Logik selbst ist in planning.test.ts abgedeckt.
 */

const showUndo = vi.fn()

function renderWeek() {
  return render(
    <MemoryRouter>
      <OverlaysContext.Provider value={{ openCapture: () => {}, showUndo }}>
        <Week />
      </OverlaysContext.Provider>
    </MemoryRouter>,
  )
}

/** Morgen (echter Zukunfts-Tag); an Sonntagen liegt er in der Folgewoche. */
function tomorrow(): { key: string; inCurrentWeek: boolean } {
  const now = new Date()
  const next = new Date(now)
  next.setDate(now.getDate() + 1)
  return { key: todayKey(next), inCurrentWeek: now.getDay() !== 0 }
}

/** Falls morgen in der Folgewoche liegt: dorthin blättern. */
async function gotoWeekOf(inCurrentWeek: boolean) {
  if (!inCurrentWeek) fireEvent.click(await screen.findByLabelText('Nächste Woche'))
}

const base = { per: 'g' as const, kcal: 200, protein: 10, carbs: 20, fat: 4 }

describe('Week — Vorausplanung', () => {
  beforeEach(async () => {
    showUndo.mockClear()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('zeigt geplante Einträge dezent (Chip, +kcal, Kosten, fehlende Zutat) und bestätigt mit Undo', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    await setFoodPrice(food.id, { amount: 2, per: 500 })
    const { key, inCurrentWeek } = tomorrow()
    await planFood({
      food: (await db.foods.get(food.id))!,
      date: key,
      meal: 'dinner',
      amount: 100,
      unit: 'g',
    })

    renderWeek()
    await gotoWeekOf(inCurrentWeek)

    // Dezenter Plan-Eintrag: Chip + kursive kcal in der Tageszeile.
    expect(await screen.findByText('geplant')).toBeTruthy()
    expect(screen.getByText('+200 geplant')).toBeTruthy()
    // Fußzeile: Kosten-Snapshot + fehlende Zutat (Reis ist nicht im Vorrat).
    expect(screen.getByText(/geplant: ~/)).toBeTruthy()
    expect(screen.getByText('1 Zutat fehlt im Vorrat')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Auf die Einkaufsliste' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reis als gegessen bestätigen' }))
    await waitFor(() =>
      expect(showUndo).toHaveBeenCalledWith('Als gegessen übernommen', expect.any(Function)),
    )
    const stored = (await db.logs.toArray())[0]
    expect(stored.planned).toBeUndefined() // jetzt echter Verzehr
  })

  it('zeigt geplante Einträge auch am Zieltag und lässt sie dort bestätigen', async () => {
    const food = await createFood({ name: 'Reis', ...base })
    // Am Zieltag selbst geplant (z. B. gestern für heute) — muss sichtbar bleiben.
    await planFood({ food, date: todayKey(), meal: 'dinner', amount: 100, unit: 'g' })

    renderWeek()

    // Plan-Eintrag samt Aktionen und Fehlende-Zutaten-Hinweis am HEUTE-Panel.
    expect(await screen.findByText('geplant')).toBeTruthy()
    expect(screen.getByText('1 Zutat fehlt im Vorrat')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Planung von Reis entfernen' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reis als gegessen bestätigen' }))
    await waitFor(() =>
      expect(showUndo).toHaveBeenCalledWith('Als gegessen übernommen', expect.any(Function)),
    )
    expect((await db.logs.toArray())[0].planned).toBeUndefined()
  })

  it('plant über den Vorrats-Picker eine Mahlzeit für einen Zukunfts-Tag', async () => {
    const food = await createFood({ name: 'Nudeln', ...base })
    await setPantry(food.id, true)
    const { inCurrentWeek } = tomorrow()

    renderWeek()
    await gotoWeekOf(inCurrentWeek)

    // Jeder leere Zukunfts-Tag bietet den Einstieg — irgendeiner genügt.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Aus Vorrat planen' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Nudeln einplanen' }))

    await waitFor(() =>
      expect(showUndo).toHaveBeenCalledWith('Nudeln geplant', expect.any(Function)),
    )
    const logs = await db.logs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0].planned).toBe(true)
    expect(logs[0].date > todayKey()).toBe(true)
  })
})
