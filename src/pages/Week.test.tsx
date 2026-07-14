import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** Gestern (echter Vergangenheits-Tag); montags liegt er in der Vorwoche. */
function yesterday(): { key: string; date: Date; inCurrentWeek: boolean } {
  const now = new Date()
  const prev = new Date(now)
  prev.setDate(now.getDate() - 1)
  return { key: todayKey(prev), date: prev, inCurrentWeek: now.getDay() !== 1 }
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

  it('trägt für einen vergangenen Tag direkt einen echten Log nach (kein Plan-Umweg)', async () => {
    const food = await createFood({ name: 'Nudeln', ...base })
    await setPantry(food.id, true)
    const { key, date, inCurrentWeek } = yesterday()

    renderWeek()
    if (!inCurrentWeek) fireEvent.click(await screen.findByLabelText('Vorherige Woche'))

    // Gestriges Tages-Panel: leerer Tag bietet „Nachtragen" statt Plan-Einstieg.
    const dayLabel = new Intl.DateTimeFormat('de', { day: 'numeric', month: 'long' }).format(date)
    const panel = await screen.findByRole('region', { name: dayLabel })
    fireEvent.click(within(panel).getByRole('button', { name: 'Nachtragen' }))

    // Gleiches Sheet, anderes Verb: Titel + Pick-Label sagen „nachtragen".
    expect(await screen.findByText('Mahlzeit nachtragen')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Nudeln nachtragen' }))

    await waitFor(() =>
      expect(showUndo).toHaveBeenCalledWith('Nudeln nachgetragen', expect.any(Function)),
    )
    const logs = await db.logs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0].planned).toBeUndefined() // echter Verzehr, kein planned-Log
    expect(logs[0].date).toBe(key)
    // Vorrats-Abzug wie beim normalen Loggen: die Packung ist jetzt leer.
    expect((await db.foods.get(food.id))!.pantryQty).toBe(0)
  })

  it('trägt über die Katalog-Suche ein Nicht-Vorrats-Lebensmittel mit Menge nach (Restaurant-Fall)', async () => {
    // Bewusst KEIN Vorrats-Artikel — bisher war so ein Nachtrag unmöglich.
    await createFood({ name: 'Restaurant-Pizza', ...base })
    const { key, date, inCurrentWeek } = yesterday()

    renderWeek()
    if (!inCurrentWeek) fireEvent.click(await screen.findByLabelText('Vorherige Woche'))

    const dayLabel = new Intl.DateTimeFormat('de', { day: 'numeric', month: 'long' }).format(date)
    const panel = await screen.findByRole('region', { name: dayLabel })
    fireEvent.click(within(panel).getByRole('button', { name: 'Nachtragen' }))

    // Ohne Suchbegriff: „Zuletzt benutzt" bietet das Lebensmittel ebenfalls an.
    expect(await screen.findByText('Zuletzt benutzt')).toBeTruthy()

    // Suche über den ganzen Katalog → Tap öffnet das Mengen-Sheet.
    fireEvent.change(screen.getByLabelText('Lebensmittel suchen …'), { target: { value: 'pizza' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Menge von Restaurant-Pizza wählen' }))

    // Menge anpassen und als echten Log für den vergangenen Tag buchen.
    const amount = await screen.findByLabelText('Menge')
    fireEvent.change(amount, { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Eintragen' }))

    await waitFor(() =>
      expect(showUndo).toHaveBeenCalledWith('Restaurant-Pizza nachgetragen', expect.any(Function)),
    )
    const logs = await db.logs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0].date).toBe(key)
    expect(logs[0].amount).toBe(250)
    expect(logs[0].planned).toBeUndefined() // echter Verzehr, kein Plan
  })

  it('plant über die Katalog-Suche mit dem Mengen-Sheet einen planned-Eintrag', async () => {
    await createFood({ name: 'Sushi Box', ...base })
    const { inCurrentWeek } = tomorrow()

    renderWeek()
    await gotoWeekOf(inCurrentWeek)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Aus Vorrat planen' }))[0])
    fireEvent.change(await screen.findByLabelText('Lebensmittel suchen …'), { target: { value: 'sushi' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Menge von Sushi Box wählen' }))

    // Plan-Modus des Mengen-Sheets: Menge anpassbar, Button „Einplanen".
    fireEvent.change(await screen.findByLabelText('Menge'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Einplanen' }))

    await waitFor(() =>
      expect(showUndo).toHaveBeenCalledWith('Sushi Box geplant', expect.any(Function)),
    )
    const logs = await db.logs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0].planned).toBe(true)
    expect(logs[0].amount).toBe(300)
    expect(logs[0].date > todayKey()).toBe(true)
  })

  it('öffnet über den Zeitraum den Monatskalender und springt zum getippten Tag', async () => {
    renderWeek()
    fireEvent.click(await screen.findByRole('button', { name: 'Kalender öffnen' }))

    const now = new Date()
    const monthTitle = now.toLocaleDateString('de', { month: 'long', year: 'numeric' })
    expect(await screen.findByText(monthTitle)).toBeTruthy()

    // Einen Monat zurückblättern (12 Monate Rückblick erlaubt).
    fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevTitle = prevFirst.toLocaleDateString('de', { month: 'long', year: 'numeric' })
    expect(await screen.findByText(prevTitle)).toBeTruthy()

    // Tag antippen → Week springt in die passende Woche (Panel des Tages da).
    const prevFirstLabel = prevFirst.toLocaleDateString('de', { day: 'numeric', month: 'long' })
    fireEvent.click(await screen.findByRole('button', { name: `${prevFirstLabel}, 0 Einträge` }))
    expect(await screen.findByRole('region', { name: prevFirstLabel })).toBeTruthy()
  })
})
