/**
 * Übergabe des frisch aufgenommenen (verkleinerten) Bildes vom Erfass-Quick-Sheet
 * an den /capture-Screen, damit die Kamera direkt öffnet und danach ohne
 * Zwischenschritt die Vorschau erscheint.
 *
 * Wird per `peek` gelesen (NICHT beim Lesen geleert), weil die Seiten-Transition
 * die Zielseite kurzzeitig doppelt mountet — sonst bekäme der sichtbare Mount
 * `null`. Explizit geleert wird nach Verwendung (Analyse/Neu aufnehmen/Zurück).
 */
let pending: string | null = null

export function setPendingImage(img: string) {
  pending = img
}

export function peekPendingImage(): string | null {
  return pending
}

export function clearPendingImage() {
  pending = null
}
