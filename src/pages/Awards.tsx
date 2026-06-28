import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Flame, Snowflake, Lock } from 'lucide-react'
import { useGamification } from '@/hooks/useGamification'
import { BADGES } from '@/lib/gamification'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

const PLANT = ['🌱', '🌿', '🪴', '🌳', '🌳']

export function Awards() {
  const { t } = useTranslation()
  const g = useGamification()

  if (!g) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('awards.title')} />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const { stats, unlocked, companion, freezeTokens } = g
  const levelFloor = (stats.level - 1) * 100
  const intoLevel = stats.points - levelFloor
  const pct = Math.min(intoLevel / 100, 1)

  return (
    <div className="space-y-5">
      <PageHeader title={t('awards.title')} />

      {/* Level & Punkte */}
      <Card className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-bold">{t('awards.level', { level: stats.level })}</span>
          <span className="text-sm text-muted-foreground">{t('awards.points', { points: stats.points })}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${pct * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('awards.toNext', { count: stats.nextLevelAt - stats.points, level: stats.level + 1 })}
        </p>
      </Card>

      {/* Streak + Freeze */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="flex items-center gap-3 p-4">
          <Flame className={stats.overallStreak > 0 ? 'text-accent' : 'text-muted-foreground'} size={32} />
          <div>
            <div className="text-lg font-bold tabular-nums">{stats.overallStreak}</div>
            <div className="text-xs text-muted-foreground">
              {stats.overallStreak > 0 ? t('awards.streak', { count: stats.overallStreak }) : t('awards.streakNone')}
            </div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <Snowflake className="text-primary" size={32} />
          <div>
            <div className="text-lg font-bold tabular-nums">{freezeTokens}</div>
            <div className="text-xs text-muted-foreground">{t('awards.freeze', { count: freezeTokens })}</div>
          </div>
        </Card>
      </div>

      {/* Begleiter */}
      <Card className="flex items-center gap-4 p-4">
        <motion.div
          key={companion.stage}
          initial={{ scale: 0.6, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12 }}
          className="text-5xl"
        >
          {PLANT[companion.stage]}
        </motion.div>
        <div>
          <div className="font-semibold">{t('awards.companionTitle')}</div>
          <div className="text-sm text-muted-foreground">{t(`awards.companionMood.${companion.mood}`)}</div>
        </div>
      </Card>

      {/* Badges */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('awards.badges')}</h2>
        <div className="grid grid-cols-3 gap-3">
          {BADGES.map((b) => {
            const has = unlocked.has(b.key)
            return (
              <motion.div
                key={b.key}
                whileTap={{ scale: 0.95 }}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-center ${
                  has ? 'border-primary/40 bg-primary/5' : 'border-border bg-card opacity-60'
                }`}
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${has ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {has ? '🏅' : <Lock size={18} />}
                </span>
                <span className="text-[11px] leading-tight">{t(`awards.badgeNames.${b.key}`)}</span>
              </motion.div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
