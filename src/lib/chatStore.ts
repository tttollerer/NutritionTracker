import type { ChatMessage } from './coach'

/**
 * Coach-Verlauf in sessionStorage (übersteht Reload, bleibt sitzungslokal —
 * Architektur-Entscheidung API_CONTRACT.md §4). Seit Paket 11 trägt jede
 * Nachricht auch `applied` (übernommene Vorschläge → keine Doppel-Übernahme
 * nach Reload) und optional `image` (Foto-Anhang als Data-URL).
 */
const KEY = 'nt-chat'

export function loadChat(): ChatMessage[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : []
  } catch {
    return []
  }
}

/** Chat-Verlauf komplett räumen — Teil des App-Resets (repo.resetAllData, Befund 13). */
export function clearChat() {
  sessionStorage.removeItem(KEY)
}

export function saveChat(messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(messages))
  } catch {
    // Quota voll (Foto-Anhänge): Bilder weglassen, Text + applied-Status behalten.
    try {
      const withoutImages = messages.map((m) => {
        const { image, ...rest } = m
        void image
        return rest
      })
      sessionStorage.setItem(KEY, JSON.stringify(withoutImages))
    } catch {
      // Verlauf ist flüchtiger Arbeitszustand — im Zweifel verzichtbar.
    }
  }
}
