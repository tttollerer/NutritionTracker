/**
 * Fordert persistenten Speicher an, damit der Browser IndexedDB nicht bei
 * Speicherdruck löscht (v. a. relevant auf iOS). Siehe PLAN.md §A3.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !navigator.storage.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
