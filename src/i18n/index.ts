import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import { brand } from '@/lib/brand'

/**
 * i18next von Anfang an verdrahtet: alle Texte sind ausgelagert, damit weitere
 * Sprachen ohne Umbau ergänzt werden können (PLAN.md §3, §8).
 * Der App-Name kommt aus der Markenkonfiguration (White-Label).
 */
const deResources = { ...de, app: { ...de.app, name: brand.name } }

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: deResources },
  },
  lng: 'de',
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
})

export default i18n
