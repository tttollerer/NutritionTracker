import { useTranslation } from 'react-i18next'
import { daysUntilExpiry, EXPIRY_SOON_DAYS } from '@/lib/pantryStock'

/**
 * MHD-Badge (FoodDetailSheet + Vorratszeilen): „läuft in N Tagen ab" (warning)
 * bzw. „abgelaufen" (destructive). Außerhalb des Fensters rendert es nichts —
 * ein MHD in ferner Zukunft ist kein Hinweis wert.
 */
export function ExpiryBadge({ expiryDate, today }: { expiryDate: string; today?: string }) {
  const { t } = useTranslation()
  const days = daysUntilExpiry(expiryDate, today)
  if (days > EXPIRY_SOON_DAYS) return null

  const label =
    days < 0
      ? t('food.expiry.expired')
      : days === 0
        ? t('food.expiry.expiresToday')
        : t('food.expiry.expiresIn', { count: days })
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        days < 0
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-warning/40 bg-warning/15 text-warning-text'
      }`}
    >
      {label}
    </span>
  )
}
