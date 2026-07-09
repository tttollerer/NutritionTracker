import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from './theme-provider'
import { THEME_RESTORED_EVENT, resolveMode, readStoredMode, useThemeControls } from './theme-context'

function mockMatchMedia(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
  mockMatchMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveMode', () => {
  it('löst system anhand der OS-Präferenz auf', () => {
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
  })
  it('gibt expliziten Mode unverändert zurück', () => {
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })
})

describe('readStoredMode', () => {
  it('migriert den alten nt-theme-Key', () => {
    localStorage.setItem('nt-theme', 'dark')
    expect(readStoredMode()).toBe('dark')
  })
  it('bevorzugt nt-theme-mode', () => {
    localStorage.setItem('nt-theme', 'dark')
    localStorage.setItem('nt-theme-mode', 'light')
    expect(readStoredMode()).toBe('light')
  })
  it('fällt bei Fremdwert auf system zurück', () => {
    localStorage.setItem('nt-theme-mode', 'neon')
    expect(readStoredMode()).toBe('system')
  })
})

describe('ThemeProvider', () => {
  it('setzt data-theme und dark-Klasse (system + OS dunkel)', () => {
    mockMatchMedia(true)
    act(() => {
      renderHook(() => useThemeControls(), { wrapper })
    })
    expect(document.documentElement.dataset.theme).toBe('vital')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setMode("light") entfernt dark und persistiert', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useThemeControls(), { wrapper })
    act(() => result.current.setMode('light'))
    expect(result.current.resolvedMode).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('nt-theme-mode')).toBe('light')
  })

  it('setVariant persistiert die Brand-Variante', () => {
    const { result } = renderHook(() => useThemeControls(), { wrapper })
    act(() => result.current.setVariant('vital'))
    expect(localStorage.getItem('nt-theme-variant')).toBe('vital')
    expect(document.documentElement.dataset.theme).toBe('vital')
  })

  it('übernimmt extern gesetzte Werte über THEME_RESTORED_EVENT (Backup-Import)', () => {
    const { result } = renderHook(() => useThemeControls(), { wrapper })
    // Backup-Import schreibt localStorage direkt und feuert das Event.
    localStorage.setItem('nt-theme-mode', 'dark')
    localStorage.setItem('nt-theme-variant', 'classic')
    act(() => {
      window.dispatchEvent(new Event(THEME_RESTORED_EVENT))
    })
    expect(result.current.mode).toBe('dark')
    expect(result.current.variant).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
