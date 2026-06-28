export type ThemeMode = 'light' | 'dark' | 'system'
export type BrandTheme = 'vital' | 'classic'

export interface ThemeMeta {
  id: BrandTheme
  label: string
  swatch: { primary: string; accent: string }
}

export const THEMES: ThemeMeta[] = [
  { id: 'vital', label: 'Vital', swatch: { primary: '#10b981', accent: '#06b6d4' } },
  { id: 'classic', label: 'Klassisch', swatch: { primary: '#16a34a', accent: '#f97316' } },
]

export const DEFAULT_MODE: ThemeMode = 'system'
export const DEFAULT_VARIANT: BrandTheme = 'vital'

const MODES: ThemeMode[] = ['light', 'dark', 'system']

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (MODES as string[]).includes(v)
}

export function isBrandTheme(v: unknown): v is BrandTheme {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}
