import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { requestPersistentStorage } from './lib/storage'
import './i18n'
import './index.css'

// Gespeichertes Theme früh anwenden (vor dem ersten Render).
const storedTheme = localStorage.getItem('nt-theme') ?? 'dark'
document.documentElement.classList.toggle('dark', storedTheme === 'dark')

// PWA-Service-Worker registrieren (Update-Prompt-Strategie).
registerSW({ immediate: true })

// Persistenten Speicher anfragen, damit IndexedDB nicht evicted wird.
void requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
