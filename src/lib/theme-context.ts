import { createContext, useContext } from 'react'
import {
  DEFAULT_MODE,
  DEFAULT_VARIANT,
  isBrandTheme,
  isThemeMode,
  type BrandTheme,
  type ThemeMode,
} from './themes'

export const MODE_KEY = 'nt-theme-mode'
export const VARIANT_KEY = 'nt-theme-variant'
const LEGACY_KEY = 'nt-theme'

/**
 * Window-Event, mit dem außerhalb des Providers gesetzte Theme-Werte
 * (z. B. Backup-Import schreibt localStorage) angekündigt werden — der
 * ThemeProvider liest die Storage-Werte dann neu ein.
 */
export const THEME_RESTORED_EVENT = 'nt-theme-restored'

export function resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

export function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (isThemeMode(stored)) return stored
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'light' || legacy === 'dark') return legacy
  } catch {
    /* localStorage blockiert */
  }
  return DEFAULT_MODE
}

export function readStoredVariant(): BrandTheme {
  try {
    const stored = localStorage.getItem(VARIANT_KEY)
    if (isBrandTheme(stored)) return stored
  } catch {
    /* localStorage blockiert */
  }
  return DEFAULT_VARIANT
}

export interface ThemeControls {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  variant: BrandTheme
  setVariant: (v: BrandTheme) => void
  resolvedMode: 'light' | 'dark'
}

export const ThemeContext = createContext<ThemeControls | null>(null)

export function useThemeControls(): ThemeControls {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeControls must be used within a ThemeProvider')
  return ctx
}
