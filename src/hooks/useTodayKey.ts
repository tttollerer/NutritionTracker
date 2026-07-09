import { useEffect, useState } from 'react'
import { todayKey } from '@/lib/utils'

/**
 * Reaktiver Tages-Schlüssel (Erwartungs-Audit Befund 1): todayKey() nur beim
 * Render einzufrieren lässt „Heute" über Mitternacht hinweg den alten Tag
 * anzeigen (PWA bleibt tagelang offen). Der Hook hält den Schlüssel als State
 * und aktualisiert ihn
 *  - per Timeout exakt zum Mitternachtswechsel (danach neu geplant) und
 *  - bei visibilitychange → 'visible' (App kommt aus dem Hintergrund zurück;
 *    Timer sind auf Mobile im Hintergrund nicht zuverlässig).
 *
 * NUR für den Renderpfad. Schreibpfade (z. B. Add.tsx) berechnen weiterhin im
 * Moment des Speicherns ein frisches todayKey().
 */
export function useTodayKey(): string {
  const [key, setKey] = useState(() => todayKey())

  useEffect(() => {
    // Funktionaler Setter: nur bei echtem Tageswechsel neu rendern.
    const update = () => setKey((prev) => (todayKey() === prev ? prev : todayKey()))

    let timer: ReturnType<typeof setTimeout>
    const scheduleMidnight = () => {
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      // +1 s Puffer, damit der Tick sicher NACH dem Datumswechsel feuert.
      timer = setTimeout(() => {
        update()
        scheduleMidnight()
      }, midnight.getTime() - now.getTime() + 1000)
    }
    scheduleMidnight()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') update()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return key
}
