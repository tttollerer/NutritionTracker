import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-freundliches Zusammenführen von Klassennamen. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Lokaler Tag als 'YYYY-MM-DD'. */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
