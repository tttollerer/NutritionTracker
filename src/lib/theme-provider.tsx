import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { type BrandTheme, type ThemeMode } from './themes'
import {
  MODE_KEY,
  VARIANT_KEY,
  ThemeContext,
  resolveMode,
  readStoredMode,
  readStoredVariant,
  type ThemeControls,
} from './theme-context'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function applyToDom(variant: BrandTheme, resolved: 'light' | 'dark') {
  const el = document.documentElement
  el.dataset.theme = variant
  el.classList.toggle('dark', resolved === 'dark')
}

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
