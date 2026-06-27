import type { ChatMessage } from './coach'

/** Coach-Verlauf in sessionStorage (übersteht Reload, bleibt sitzungslokal). */
const KEY = 'nt-chat'

export function loadChat(): ChatMessage[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as ChatMessage[]
  } catch {
    return []
  }
}

export function saveChat(messages: ChatMessage[]) {
  sessionStorage.setItem(KEY, JSON.stringify(messages))
}
