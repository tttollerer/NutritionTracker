/**
 * White-Label Stufe 0: Markenkonfiguration aus Build-ENV (`VITE_BRAND_*`).
 * Erlaubt gebrandete Deploys pro Mandant ohne Codefork — Name, Kurzname,
 * Beschreibung, Akzentfarbe und der Coach-Name sind austauschbar.
 * Fehlt eine Variable, greift der NutriScan-Default.
 */
const env = import.meta.env

export const brand = {
  name: env.VITE_BRAND_NAME || 'NutriScan',
  short: env.VITE_BRAND_SHORT || 'NutriScan',
  description: env.VITE_BRAND_DESCRIPTION || 'Kalorien, Makros & Mineralstoffe tracken – mit KI-Unterstützung.',
  themeColor: env.VITE_BRAND_THEME_COLOR || '#16a34a',
  coachName: env.VITE_COACH_NAME || '',
}
