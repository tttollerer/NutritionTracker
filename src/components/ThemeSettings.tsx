import { useTranslation } from 'react-i18next'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useThemeControls } from '@/lib/theme-provider'
import { THEMES, type ThemeMode } from '@/lib/themes'
import { Card } from '@/components/ui/Card'

const MODE_OPTIONS: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'profile.modeLight' },
  { value: 'dark', icon: Moon, labelKey: 'profile.modeDark' },
  { value: 'system', icon: Monitor, labelKey: 'profile.modeSystem' },
]

export function ThemeSettings() {
  const { t } = useTranslation()
  const { mode, setMode, variant, setVariant } = useThemeControls()

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('profile.appearance')}</h2>
        <div
          role="radiogroup"
          aria-label={t('profile.appearance')}
          className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = mode === opt.value
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                onClick={() => setMode(opt.value)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <Icon size={16} />
                {t(opt.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('profile.brandTheme')}</h2>
        <div className="flex gap-2 overflow-x-auto">
          {THEMES.map((th) => {
            const active = variant === th.id
            return (
              <button
                key={th.id}
                aria-pressed={active}
                onClick={() => setVariant(th.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                  active ? 'border-primary' : 'border-border'
                }`}
              >
                <span className="flex">
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: th.swatch.primary }}
                  />
                  <span
                    className="-ml-1 h-4 w-4 rounded-full"
                    style={{ background: th.swatch.accent }}
                  />
                </span>
                <span className="font-medium">{th.label}</span>
                {active && <Check size={16} className="text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
