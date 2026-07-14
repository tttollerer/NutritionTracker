import { beforeEach, describe, expect, it } from 'vitest'
import { clearChat, loadChat, MAX_MESSAGES, saveChat } from './chatStore'
import type { ChatMessage } from './coach'

const msg = (i: number): ChatMessage => ({ role: i % 2 ? 'assistant' : 'user', content: `Nachricht ${i}` })

describe('chatStore (localStorage, Coach-Kontinuität)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('leerer Speicher → leerer Verlauf', () => {
    expect(loadChat()).toEqual([])
  })

  it('Roundtrip erhält den applied-Status (keine Doppel-Übernahme nach Reload)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Was soll ich essen?' },
      {
        role: 'assistant',
        content: 'Wie wäre es mit Skyr?',
        suggestions: { logs: [{ name: 'Skyr', amount: 150, unit: 'g', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 } }] },
        applied: ['log0'],
      },
    ]
    saveChat(messages)
    const loaded = loadChat()
    expect(loaded).toEqual(messages)
    expect(loaded[1].applied).toContain('log0')
  })

  it('Roundtrip erhält den Foto-Anhang der Nachricht', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Was sagst du dazu?', image: 'data:image/jpeg;base64,QUJD' },
    ]
    saveChat(messages)
    expect(loadChat()[0].image).toBe('data:image/jpeg;base64,QUJD')
  })

  it('persistiert in localStorage → überlebt das Ende der Session (PWA-Neustart)', () => {
    saveChat([msg(0)])
    expect(localStorage.getItem('nt-chat')).not.toBeNull()
    // Simulierter Kaltstart: sessionStorage ist weg, localStorage bleibt.
    sessionStorage.clear()
    expect(loadChat()).toEqual([msg(0)])
  })

  it('kaputter/fremder Speicherinhalt → leerer Verlauf statt Crash', () => {
    localStorage.setItem('nt-chat', '{nicht json')
    expect(loadChat()).toEqual([])
    localStorage.setItem('nt-chat', '{"kein":"array"}')
    expect(loadChat()).toEqual([])
  })

  it('Trimming: beim Speichern bleiben nur die letzten MAX_MESSAGES Nachrichten', () => {
    const many = Array.from({ length: MAX_MESSAGES + 17 }, (_, i) => msg(i))
    saveChat(many)
    const loaded = loadChat()
    expect(loaded).toHaveLength(MAX_MESSAGES)
    // Die neuesten bleiben, die ältesten fallen weg.
    expect(loaded[0]).toEqual(msg(17))
    expect(loaded[loaded.length - 1]).toEqual(msg(MAX_MESSAGES + 16))
  })

  it('Trimming greift auch beim Laden eines überlangen Altbestands', () => {
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => msg(i))
    localStorage.setItem('nt-chat', JSON.stringify(many))
    const loaded = loadChat()
    expect(loaded).toHaveLength(MAX_MESSAGES)
    expect(loaded[0]).toEqual(msg(5))
  })

  it('Migration: alter sessionStorage-Verlauf wird übernommen und entfernt', () => {
    const legacy = [msg(0), msg(1)]
    sessionStorage.setItem('nt-chat', JSON.stringify(legacy))
    expect(loadChat()).toEqual(legacy)
    // Alt-Key ist weg, neuer Speicherort gefüllt — beim nächsten Laden stabil.
    expect(sessionStorage.getItem('nt-chat')).toBeNull()
    expect(loadChat()).toEqual(legacy)
    expect(JSON.parse(localStorage.getItem('nt-chat') ?? '[]')).toEqual(legacy)
  })

  it('Migration überschreibt einen bereits vorhandenen localStorage-Verlauf nicht', () => {
    saveChat([msg(0)])
    sessionStorage.setItem('nt-chat', JSON.stringify([msg(1), msg(2)]))
    expect(loadChat()).toEqual([msg(0)])
    expect(sessionStorage.getItem('nt-chat')).toBeNull()
  })

  it('clearChat räumt neuen und alten Speicherort', () => {
    saveChat([msg(0)])
    sessionStorage.setItem('nt-chat', JSON.stringify([msg(1)]))
    clearChat()
    expect(localStorage.getItem('nt-chat')).toBeNull()
    expect(sessionStorage.getItem('nt-chat')).toBeNull()
    expect(loadChat()).toEqual([])
  })
})
