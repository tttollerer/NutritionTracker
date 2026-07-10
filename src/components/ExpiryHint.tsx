import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { ChevronRight, Clock } from 'lucide-react'
import { expiringSoon, EXPIRY_SOON_DAYS } from '@/lib/pantryStock'

/**
 * Dezente Hinweiszeile auf „Heute" (NudgeCard-Optik, warning-Ton): N Artikel
 * im Vorrat laufen bald ab → Link zum Einkauf-Tab. Rendert nichts, wenn
 * nichts abläuft. `today` injizierbar für Tests / Mitternachts-Reaktivität.
 */
export function ExpiryHint({ today }: { today?: string }) {
  const { t } = useTranslation()
  const expiring = useLiveQuery(() => expiringSoon(EXPIRY_SOON_DAYS, today), [today])
  if (!expiring || expiring.length === 0) return null

  return (
    <Link
      to="/pantry"
      className="focus-ring flex min-h-[48px] items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-3.5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning-text">
        <Clock size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-sm">{t('today.expiringHint', { count: expiring.length })}</span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
    </Link>
  )
}
