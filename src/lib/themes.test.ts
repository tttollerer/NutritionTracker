import { describe, expect, it } from 'vitest'
import {
  THEMES,
  DEFAULT_MODE,
  DEFAULT_VARIANT,
  isBrandTheme,
  isThemeMode,
} from './themes'

describe('themes registry', () => {
  it('hat mindestens das vital-Theme mit vollständigem Swatch', () => {
    const vital = THEMES.find((t) => t.id === 'vital')
    expect(vital).toBeDefined()
    expect(vital?.label).toBeTruthy()
    expect(vital?.swatch.primary).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(vital?.swatch.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('jedes Theme hat eindeutige id und vollständige Felder', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of THEMES) {
      expect(t.label).toBeTruthy()
      expect(t.swatch.primary).toBeTruthy()
      expect(t.swatch.accent).toBeTruthy()
    }
  })

  it('Defaults sind gültig', () => {
    expect(DEFAULT_MODE).toBe('system')
    expect(isThemeMode(DEFAULT_MODE)).toBe(true)
    expect(isBrandTheme(DEFAULT_VARIANT)).toBe(true)
  })

  it('Guards lehnen Fremdwerte ab', () => {
    expect(isThemeMode('neon')).toBe(false)
    expect(isBrandTheme('forest')).toBe(false)
    expect(isBrandTheme(null)).toBe(false)
  })
})
