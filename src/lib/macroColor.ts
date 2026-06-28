export type MacroKey = 'protein' | 'carbs' | 'fat'

/** Tailwind-Hintergrundklasse je Makronährstoff (Token-basiert, theme-fähig). */
export function macroColor(key: MacroKey): string {
  return key === 'protein' ? 'bg-protein' : key === 'carbs' ? 'bg-carbs' : 'bg-fat'
}
