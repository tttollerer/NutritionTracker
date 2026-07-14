import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { db } from '@/db'
import { createFood, logFood, setPantry, updateSettings } from '@/db/repo'
import { updateFoodValues } from '@/lib/foodEdit'
import { todayKey } from '@/lib/utils'
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

/**
 * UX-Fix „ein Sheet für alles": Statt des abgespeckten EditLogSheets öffnet
 * das Bearbeiten eines Log-Eintrags dasselbe reiche Mengen-Sheet im
 * Edit-Modus (editEntry) — vorbefüllt, Speichern via updateLog, OHNE
 * erneuten Vorrats-Abzug.
 */
describe('PortionSheet — Edit-Modus (editEntry)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('vorbefüllt mit serving-Snapshot; Speichern patcht via updateLog und rechnet computed neu', async () => {
    const food = await makeFood([{ label: 'Kappe', amount: 30 }])
    const entry = await logFood({
      food,
      date: '2026-07-14',
      meal: 'breakfast',
      amount: 60,
      unit: 'g',
      serving: { label: 'Kappe', count: 2 },
    })
    const onClose = vi.fn()
    render(<PortionSheet food={food} editEntry={entry} initialMeal="lunch" onClose={onClose} />)

    // Edit-Framing: Titel-Overline + Primärbutton „Speichern" statt „Eintragen".
    expect(await screen.findByText('Eintrag bearbeiten')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eintragen' })).toBeNull()

    // Vorbefüllung: serving-Snapshot → Kappe-Chip aktiv, Menge = count (2),
    // Mahlzeit = die des Eintrags (nicht initialMeal).
    expect(screen.getByRole('button', { name: 'Kappe (30 g)' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Menge') as HTMLInputElement).value).toBe('2')

    // Korrektur: 3 Kappen, Mahlzeit → Abend.
    fireEvent.change(amountInput(), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const stored = (await db.logs.get(entry.id))!
    expect(stored.amount).toBe(90) // 3 × Kappe (30 g)
    expect(stored.unit).toBe('g')
    expect(stored.serving).toEqual({ label: 'Kappe', count: 3 })
    expect(stored.meal).toBe('dinner')
    // computed neu gerechnet: 380 kcal / 100 g × 90 g.
    expect(stored.computed.kcal).toBe(342)
    // Es wurde kein zweiter Eintrag angelegt.
    expect(await db.logs.count()).toBe(1)
  })

  it('zieht beim Speichern KEINEN Vorrats-Bestand ab und ruft onLogged nicht', async () => {
    const food = await makeFood()
    await setPantry(food.id, true) // 1 Packung (pantryQty undefined == 1)
    const entry = await logFood({ food, date: '2026-07-14', meal: 'lunch', amount: 100, unit: 'g' })
    const onLogged = vi.fn()
    render(
      <PortionSheet food={food} editEntry={entry} initialMeal="lunch" onClose={() => {}} onLogged={onLogged} />,
    )

    fireEvent.change(amountInput(), { target: { value: '80' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }))

    await waitFor(async () => expect((await db.logs.get(entry.id))!.amount).toBe(80))
    // Bestand unangetastet (ein Abzug hätte pantryQty auf 0 gesetzt) …
    const storedFood = (await db.foods.get(food.id))!
    expect(storedFood.pantry).toBe(true)
    expect(storedFood.pantryQty).toBeUndefined()
    // … und der Log-Modus-Callback (Undo-Toast + Vorrats-Abzug) bleibt stumm.
    expect(onLogged).not.toHaveBeenCalled()
  })
})

/**
 * Wochenplaner (Nachtragen/Planen vollwertig): das Mengen-Sheet bucht über den
 * optionalen `date`-Prop auf einen anderen Tag und legt mit `planned` einen
 * geplanten Eintrag (planFood) statt eines echten Logs an. Ohne die neuen
 * Props bleibt das Verhalten exakt wie bisher (heute, echter Log).
 */
describe('PortionSheet — date-/planned-Props (Wochenplaner)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('loggt ohne date-Prop unverändert auf heute (Default-Verhalten)', async () => {
    const food = await makeFood()
    const onLogged = vi.fn()
    render(<PortionSheet food={food} initialMeal="lunch" onClose={() => {}} onLogged={onLogged} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Eintragen' }))

    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1))
    const entry = onLogged.mock.calls[0][0] as LogEntry
    expect(entry.date).toBe(todayKey())
    expect(entry.planned).toBeUndefined()
  })

  it('bucht mit date-Prop einen echten Log auf den Zieltag (Nachtragen, Menge anpassbar)', async () => {
    const food = await makeFood()
    const onLogged = vi.fn()
    render(
      <PortionSheet food={food} date="2026-07-10" initialMeal="dinner" onClose={() => {}} onLogged={onLogged} />,
    )

    // Overline macht den Kontext klar: Nachtragen + Zieltag.
    expect(await screen.findByText(/Mahlzeit nachtragen · /)).toBeInTheDocument()
    fireEvent.change(amountInput(), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1))
    const entry = onLogged.mock.calls[0][0] as LogEntry
    expect(entry.date).toBe('2026-07-10')
    expect(entry.amount).toBe(250)
    expect(entry.planned).toBeUndefined() // Vergangenheit = gegessen, kein Plan
    expect((await db.logs.get(entry.id))!.date).toBe('2026-07-10')
  })

  it('legt mit planned-Prop einen geplanten Eintrag (planned=true) für den Zieltag an', async () => {
    const food = await makeFood()
    const onLogged = vi.fn()
    render(
      <PortionSheet food={food} date="2027-01-05" planned initialMeal="dinner" onClose={() => {}} onLogged={onLogged} />,
    )

    // Plan-Modus: Primärbutton heißt „Einplanen" statt „Eintragen".
    expect(screen.queryByRole('button', { name: 'Eintragen' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Einplanen' }))

    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1))
    const entry = onLogged.mock.calls[0][0] as LogEntry
    expect(entry.planned).toBe(true)
    expect(entry.date).toBe('2027-01-05')
    expect((await db.logs.get(entry.id))!.planned).toBe(true)
  })
})

/**
 * Eintrag verschieben: die Datums-Zeile im Edit-Modus (Chips Heute/Gestern +
 * „Anderer Tag …" über den Monatskalender) aktualisiert das date des Eintrags
 * via updateLog — Löschen + Neuanlegen entfällt.
 */
describe('PortionSheet — Datum verschieben (Edit-Modus)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('Chip „Gestern" verschiebt den Eintrag beim Speichern auf gestern', async () => {
    const food = await makeFood()
    const entry = await logFood({ food, date: todayKey(), meal: 'lunch', amount: 100, unit: 'g' })
    render(<PortionSheet food={food} editEntry={entry} initialMeal="lunch" onClose={() => {}} />)

    // Datums-Zeile: heute ist vorausgewählt.
    expect(await screen.findByRole('button', { name: 'Heute' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Gestern' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    const y = new Date()
    y.setDate(y.getDate() - 1)
    await waitFor(async () => expect((await db.logs.get(entry.id))!.date).toBe(todayKey(y)))
    // Werte bleiben unangetastet — nur der Tag wandert.
    expect((await db.logs.get(entry.id))!.amount).toBe(100)
  })

  it('„Anderer Tag …" öffnet den Monatskalender und übernimmt den getippten Tag', async () => {
    const food = await makeFood()
    const entry = await logFood({ food, date: todayKey(), meal: 'lunch', amount: 100, unit: 'g' })
    render(<PortionSheet food={food} editEntry={entry} initialMeal="lunch" onClose={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Anderer Tag …' }))
    expect(await screen.findByRole('dialog', { name: 'Kalender' })).toBeInTheDocument()

    // Einen anderen Tag des aktuellen Monats antippen (nicht heute).
    const now = new Date()
    const targetDay = now.getDate() === 1 ? 2 : 1
    const target = new Date(now.getFullYear(), now.getMonth(), targetDay)
    const targetLabel = target.toLocaleDateString('de', { day: 'numeric', month: 'long' })
    fireEvent.click(await screen.findByRole('button', { name: `${targetLabel}, 0 Einträge` }))

    // Kalender zu, gewählter Tag steht als aktiver Chip — Speichern verschiebt.
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(async () => expect((await db.logs.get(entry.id))!.date).toBe(todayKey(target)))
  })
})

/**
 * Direkteinstieg „Menge per Foto" (Usability-Audit #9): mit autoPhotoEstimate
 * stößt das Sheet beim Öffnen selbst den Foto-Schätz-Flow an — mit erteilter
 * Einwilligung öffnet sich der verdeckte Kamera-/Galerie-Input, ohne
 * Einwilligung erscheint zuerst der Consent-Block (kein Upload ohne Zutun).
 */
describe('PortionSheet — autoPhotoEstimate (Direkteinstieg Foto-Schätzung)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  /** Klicks auf verdeckte Datei-Inputs zählen (der Direkteinstieg „tippt" den Kamera-Input an). */
  function fileInputClicks(spy: { mock: { contexts: unknown[] } }): number {
    return spy.mock.contexts.filter((el) => el instanceof HTMLInputElement && el.type === 'file').length
  }

  it('öffnet mit erteilter Einwilligung genau EINMAL den verdeckten Kamera-Input', async () => {
    await updateSettings({ photoConsent: true })
    const food = await makeFood()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    try {
      render(<PortionSheet food={food} autoPhotoEstimate initialMeal="lunch" onClose={() => {}} />)
      await waitFor(() => expect(fileInputClicks(clickSpy)).toBe(1))
      // Kein Consent-Block — die Einwilligung war bereits erteilt.
      expect(screen.queryByText('Foto an KI senden?')).toBeNull()
    } finally {
      clickSpy.mockRestore()
    }
  })

  it('zeigt ohne Einwilligung zuerst den Consent-Block statt der Kamera', async () => {
    const food = await makeFood()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    try {
      render(<PortionSheet food={food} autoPhotoEstimate initialMeal="lunch" onClose={() => {}} />)
      expect(await screen.findByText('Foto an KI senden?')).toBeInTheDocument()
      expect(fileInputClicks(clickSpy)).toBe(0)
    } finally {
      clickSpy.mockRestore()
    }
  })

  it('ohne autoPhotoEstimate bleibt das Öffnen passiv (kein Kamera-Input, kein Consent-Block)', async () => {
    const food = await makeFood()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    try {
      render(<PortionSheet food={food} initialMeal="lunch" onClose={() => {}} />)
      await screen.findByRole('button', { name: 'Eintragen' })
      expect(fileInputClicks(clickSpy)).toBe(0)
      expect(screen.queryByText('Foto an KI senden?')).toBeNull()
    } finally {
      clickSpy.mockRestore()
    }
  })
})
