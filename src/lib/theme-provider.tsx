import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_MODE,
  DEFAULT_VARIANT,
  isBrandTheme,
  isThemeMode,
  type BrandTheme,
  type ThemeMode,
} from './themes'

const MODE_KEY = 'nt-theme-mode'
const VARIANT_KEY = 'nt-theme-variant'
const LEGACY_KEY = 'nt-theme'

export function resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
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

function applyToDom(variant: BrandTheme, resolved: 'light' | 'dark') {
  const el = document.documentElement
  el.dataset.theme = variant
  el.classList.toggle('dark', resolved === 'dark')
}

interface ThemeControls {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  variant: BrandTheme
  setVariant: (v: BrandTheme) => void
  resolvedMode: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeControls | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [variant, setVariantState] = useState<BrandTheme>(readStoredVariant)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  // OS-Präferenz live verfolgen
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  const resolvedMode = resolveMode(mode, systemDark)

  useEffect(() => {
    applyToDom(variant, resolvedMode)
  }, [variant, resolvedMode])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* localStorage blockiert */
    }
  }, [])

  const setVariant = useCallback((v: BrandTheme) => {
    setVariantState(v)
    try {
      localStorage.setItem(VARIANT_KEY, v)
    } catch {
      /* localStorage blockiert */
    }
  }, [])

  const value = useMemo<ThemeControls>(
    () => ({ mode, setMode, variant, setVariant, resolvedMode }),
    [mode, setMode, variant, setVariant, resolvedMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeControls(): ThemeControls {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeControls must be used within a ThemeProvider')
  return ctx
}
