import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'

/**
 * i18next von Anfang an verdrahtet: alle Texte sind ausgelagert, damit weitere
 * Sprachen ohne Umbau ergänzt werden können (PLAN.md §3, §8).
 */
void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
  },
  lng: 'de',
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
})

export default i18n
