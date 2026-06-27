import { useTranslation } from 'react-i18next'
import { Mic } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'

export function Coach() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <PageHeader title={t('coach.title')} />
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mic size={36} />
        </span>
        <p className="max-w-xs text-sm text-muted-foreground">{t('coach.placeholder')}</p>
      </div>
    </div>
  )
}
