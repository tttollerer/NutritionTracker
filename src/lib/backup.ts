import { z } from 'zod'
import { db } from '@/db'
import { isBrandTheme, isThemeMode } from './themes'
import { MODE_KEY, VARIANT_KEY, THEME_RESTORED_EVENT } from './theme-context'

/**
 * Backup-Export/Import (PLAN.md §A3).
 *
 * Formatversionen:
 * - v1: alle Tabellen bis Schema v3 (ohne `measurements`).
 * - v2: zusätzlich `measurements` (Verlaufswerte). Import bleibt abwärtskompatibel:
 *   Tabellen, die in der Datei fehlen (z. B. `measurements` in v1-Dateien), werden
 *   beim Import NICHT geleert — so verliert ein Restore keine Daten, die das alte
 *   Format nie erfasst hat.
 * - v2 (additiv): optionales `theme`-Feld (Modus/Variante aus localStorage), damit
 *   die Darstellung ein Backup übersteht. Alte Dateien ohne das Feld importieren
 *   unverändert; unbekannte Werte werden beim Import ignoriert.
 */
export const BACKUP_VERSION = 2

/** Alle Tabellen, die im Backup landen — Reihenfolge = Export-Reihenfolge. */
const TABLES = [
  'foods',
  'logs',
  'goals',
  'profile',
  'achievements',
  'challenges',
  'gamification',
  'coachMemory',
  'water',
  'photos',
  'settings',
  'glucose',
  'measurements',
] as const

// Jeder Datensatz braucht mindestens eine String-ID (Primary Key aller Stores);
// alle weiteren Felder bleiben unangetastet (passthrough), damit Import/Export
// verlustfrei round-trippt.
const recordSchema = z.object({ id: z.string().min(1) }).passthrough()
const tableSchema = z.array(recordSchema).optional()

/** Theme-Zustand (nicht in Dexie, sondern localStorage) — optional & tolerant. */
const themeSchema = z
  .object({ mode: z.string().optional(), variant: z.string().optional() })
  .optional()

const backupSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: z.number().optional(),
  theme: themeSchema,
  foods: tableSchema,
  logs: tableSchema,
  goals: tableSchema,
  profile: tableSchema,
  achievements: tableSchema,
  challenges: tableSchema,
  gamification: tableSchema,
  coachMemory: tableSchema,
  water: tableSchema,
  photos: tableSchema,
  settings: tableSchema,
  glucose: tableSchema,
  measurements: tableSchema,
})

export type BackupFile = z.infer<typeof backupSchema>

/** Wird geworfen, wenn die Datei kein gültiges Backup ist — es wurde nichts verändert. */
export class InvalidBackupError extends Error {
  constructor(message = 'Invalid backup file') {
    super(message)
    this.name = 'InvalidBackupError'
  }
}

/** Alle Tabellen als JSON exportieren (Backup, PLAN.md §A3). */
export async function exportBackup(): Promise<Blob> {
  const data: Record<string, unknown> = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
  }
  const theme = readThemeForBackup()
  if (theme) data.theme = theme
  for (const name of TABLES) data[name] = await db.table(name).toArray()
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
}

/** Theme-Modus/-Variante aus localStorage fürs Backup (fehlt, wenn nie gesetzt). */
function readThemeForBackup(): { mode?: string; variant?: string } | undefined {
  try {
    const mode = localStorage.getItem(MODE_KEY) ?? undefined
    const variant = localStorage.getItem(VARIANT_KEY) ?? undefined
    return mode || variant ? { mode, variant } : undefined
  } catch {
    return undefined // localStorage blockiert → Backup bleibt trotzdem gültig
  }
}

/**
 * Theme-Werte aus dem Backup zurückschreiben. Nur bekannte Werte landen im
 * Storage; danach informiert THEME_RESTORED_EVENT den ThemeProvider, damit die
 * Darstellung ohne Reload umschaltet.
 */
function restoreTheme(theme?: { mode?: string; variant?: string }) {
  if (!theme) return
  try {
    let changed = false
    if (isThemeMode(theme.mode)) {
      localStorage.setItem(MODE_KEY, theme.mode)
      changed = true
    }
    if (isBrandTheme(theme.variant)) {
      localStorage.setItem(VARIANT_KEY, theme.variant)
      changed = true
    }
    if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_RESTORED_EVENT))
  } catch {
    /* localStorage blockiert — der Datenimport bleibt davon unberührt */
  }
}

/**
 * Backup einspielen (überschreibt vorhandene Daten). Die Datei wird VOR jedem
 * clear() vollständig validiert — bei ungültigem Inhalt fliegt InvalidBackupError
 * und die lokalen Daten bleiben unangetastet.
 */
export async function importBackup(json: string): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new InvalidBackupError('Not valid JSON')
  }
  const parsed = backupSchema.safeParse(raw)
  if (!parsed.success) throw new InvalidBackupError(parsed.error.message)
  if (parsed.data.version > BACKUP_VERSION) {
    throw new InvalidBackupError(`Unsupported backup version ${parsed.data.version}`)
  }
  const data = parsed.data

  await db.transaction(
    'rw',
    TABLES.map((name) => db.table(name)),
    async () => {
      for (const name of TABLES) {
        const rows = data[name]
        // Tabelle fehlt in der Datei (ältere Backup-Version) → unangetastet lassen.
        if (!rows) continue
        const table = db.table(name)
        await table.clear()
        await table.bulkPut(rows)
      }
    },
  )

  // Nach erfolgreichem Daten-Import: Theme wiederherstellen (falls im Backup).
  restoreTheme(data.theme)
}

export function downloadBackup(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nutritiontracker-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
