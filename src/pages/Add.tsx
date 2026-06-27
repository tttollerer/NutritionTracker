import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Camera, ScanText, Barcode, Keyboard } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'

export function Add() {
  const { t } = useTranslation()
  const options = [
    { icon: Camera, key: 'photo' },
    { icon: ScanText, key: 'label' },
    { icon: Barcode, key: 'barcode' },
    { icon: Keyboard, key: 'manual' },
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader title={t('add.title')} />
      <div className="grid grid-cols-2 gap-3">
        {options.map(({ icon: Icon, key }) => (
          <motion.div key={key} whileTap={{ scale: 0.96 }}>
            <Card className="flex aspect-square flex-col items-center justify-center gap-3 p-4">
              <Icon size={36} className="text-primary" />
              <span className="text-sm font-medium">{t(`add.${key}`)}</span>
            </Card>
          </motion.div>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">{t('add.soon')}</p>
    </div>
  )
}
