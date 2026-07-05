import { beforeEach, describe, expect, it } from 'vitest'
import { loadChat, saveChat } from './chatStore'
import type { ChatMessage } from './coach'

describe('chatStore (sessionStorage, Vertrag §4)', () => {
  beforeEach(() => sessionStorage.clear())

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

  it('kaputter/fremder Speicherinhalt → leerer Verlauf statt Crash', () => {
    sessionStorage.setItem('nt-chat', '{nicht json')
    expect(loadChat()).toEqual([])
    sessionStorage.setItem('nt-chat', '{"kein":"array"}')
    expect(loadChat()).toEqual([])
  })
})
