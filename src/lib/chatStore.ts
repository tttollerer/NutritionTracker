import type { ChatMessage } from './coach'

/**
 * Coach-Verlauf in localStorage — übersteht Reload UND PWA-Neustart
 * (Coach-Kontinuität: löst die frühere sessionStorage-Entscheidung aus
 * API_CONTRACT.md §4 ab, deren iOS-Einschränkung sich für Nutzer wie
 * Datenverlust anfühlte). Seit Paket 11 trägt jede Nachricht auch `applied`
 * (übernommene Vorschläge → keine Doppel-Übernahme nach Reload) und optional
 * `image` (Foto-Anhang als Data-URL).
 *
 * Damit der Verlauf nicht unbegrenzt wächst, werden beim Speichern nur die
 * letzten MAX_MESSAGES Nachrichten behalten (die API bekommt ohnehin nur die
 * letzten 20, siehe Coach.tsx).
 */
const KEY = 'nt-chat'

/** Obergrenze des persistierten Verlaufs — ältere Nachrichten fallen weg. */
export const MAX_MESSAGES = 50

function parseMessages(raw: string | null): ChatMessage[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : []
  } catch {
    return []
  }
}

/** Auf die letzten MAX_MESSAGES kappen (neueste behalten). */
function trim(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages
}

export function loadChat(): ChatMessage[] {
  // Einmalige Migration: Vor der Umstellung lag der Verlauf in sessionStorage.
  // Einen dort noch laufenden Chat übernehmen, damit er beim Update nicht
  // verloren geht — der alte Key wird danach immer entfernt.
  try {
    const legacy = sessionStorage.getItem(KEY)
    if (legacy !== null) {
      sessionStorage.removeItem(KEY)
      const legacyMessages = parseMessages(legacy)
      if (legacyMessages.length > 0 && localStorage.getItem(KEY) === null) {
        saveChat(legacyMessages)
      }
    }
  } catch {
    // sessionStorage nicht verfügbar/gesperrt — Migration still überspringen.
  }

  try {
    return trim(parseMessages(localStorage.getItem(KEY)))
  } catch {
    return []
  }
}

/** Chat-Verlauf komplett räumen — Teil des App-Resets (repo.resetAllData, Befund 13). */
export function clearChat() {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY) // Alt-Key aus der sessionStorage-Ära mitputzen
  } catch {
    // Storage gesperrt — dann gibt es auch nichts zu löschen.
  }
}

export function saveChat(messages: ChatMessage[]) {
  const trimmed = trim(messages)
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // Quota voll (Foto-Anhänge): Bilder weglassen, Text + applied-Status behalten.
    try {
      const withoutImages = trimmed.map((m) => {
        const { image, ...rest } = m
        void image
        return rest
      })
      localStorage.setItem(KEY, JSON.stringify(withoutImages))
    } catch {
      // Verlauf ist flüchtiger Arbeitszustand — im Zweifel verzichtbar.
    }
  }
}
