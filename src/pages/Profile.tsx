import { useTranslation } from 'react-i18next'
import { User } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'

export function Profile() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <PageHeader title={t('profile.title')} />
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User size={36} />
        </span>
        <p className="max-w-xs text-sm text-muted-foreground">{t('profile.placeholder')}</p>
      </div>
    </div>
  )
}
