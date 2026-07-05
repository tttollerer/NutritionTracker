/** Fehlercode für die UI-Schicht — lib-Code wirft keine übersetzten Texte (i18n gehört in die UI). */
export const IMAGE_ERROR_CANVAS = 'IMAGE_CANVAS_UNAVAILABLE' as const

/** Fehler mit maschinenlesbarem `code`; die deutsche Message bleibt als Fallback erhalten. */
export class ImageError extends Error {
  readonly code = IMAGE_ERROR_CANVAS
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

/**
 * Verkleinert ein Bild client-seitig vor dem KI-Upload (PLAN.md §A4):
 * längste Kante auf max. `maxEdge`, JPEG mit `quality`. Spart Kosten, Latenz
 * und Datenvolumen.
 */
export async function downscaleImage(file: Blob, maxEdge = 1024, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  // Aufrufer (Capture/Coach/Add) mappen über toApiError() auf errors.generic —
  // die Message wird dort nie angezeigt, bleibt aber für Debugging/Logs erhalten.
  if (!ctx) throw new ImageError('Canvas-Kontext nicht verfügbar')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return canvas.toDataURL('image/jpeg', quality)
}
