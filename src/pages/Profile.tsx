import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Upload, Moon, RefreshCw } from 'lucide-react'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import { exportBackup, downloadBackup, importBackup } from '@/lib/backup'
import { useTheme } from '@/lib/theme'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function Profile({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  const { theme, toggle } = useTheme()
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  const fileRef = useRef<HTMLInputElement>(null)

  async function onExport() {
    downloadBackup(await exportBackup())
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await importBackup(await file.text())
    e.target.value = ''
  }

  async function reset() {
    await db.profile.clear()
    onReset()
  }

  const order = ['kcal', 'protein', 'carbs', 'fat']

  return (
    <div className="space-y-6">
      <PageHeader title={t('profile.title')} />

      {goals && (
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">{t('profile.yourGoals')}</h2>
          <ul className="divide-y divide-border">
            {order
              .filter((k) => goals[k])
              .map((k) => (
                <li key={k} className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">
                    {k === 'kcal' ? 'Kalorien' : t(`today.macros.${k}`)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {goals[k].target}
                    {goals[k].targetMax ? `–${goals[k].targetMax}` : ''} {goals[k].unit}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card className="divide-y divide-border">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <span className="flex items-center gap-3">
            <Moon size={20} className="text-muted-foreground" />
            {t('profile.theme')}
          </span>
          <span className="text-sm text-muted-foreground">{theme === 'dark' ? 'An' : 'Aus'}</span>
        </button>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('profile.backup')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onExport}>
            <Download size={18} /> {t('profile.export')}
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={18} /> {t('profile.import')}
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
      </Card>

      <Button variant="ghost" className="w-full text-muted-foreground" onClick={reset}>
        <RefreshCw size={18} /> {t('profile.reset')}
      </Button>
    </div>
  )
}
