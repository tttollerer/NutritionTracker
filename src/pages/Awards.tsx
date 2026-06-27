import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'

export function Awards() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <PageHeader title={t('awards.title')} />
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Trophy size={36} />
        </span>
        <p className="max-w-xs text-sm text-muted-foreground">{t('awards.placeholder')}</p>
      </div>
    </div>
  )
}
