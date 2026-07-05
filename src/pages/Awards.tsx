import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Flame, Lock, Snowflake, Trophy, X } from 'lucide-react'
import { fireConfetti, useGamification } from '@/hooks/useGamification'
import { BADGES, POINTS_PER_CHALLENGE } from '@/lib/gamification'
import { markChallengeDone, markChallengeFailed } from '@/lib/challenges'
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

  const { stats, unlocked, companion, freezeTokens, challenges, doneChallenges } = g
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
            className="h-full rounded-full bg-brand-gradient"
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
          {/* Warm statt Akzent-Cyan: die Flamme bleibt in jedem Theme „heiß" und kontraststark. */}
          <Flame className={stats.overallStreak > 0 ? 'text-warning' : 'text-muted-foreground'} size={32} />
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

      {/* Aktive Challenges (Coach-Vorschläge, Paket 10) */}
      {(challenges.length > 0 || doneChallenges > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('awards.challenges')}</h2>
          <AnimatePresence initial={false}>
            {challenges.map(({ challenge, progress }) => (
              <motion.div
                key={challenge.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Card className="space-y-2 p-4">
                  <div className="flex items-center gap-3">
                    <Trophy className="shrink-0 text-warning" size={20} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{challenge.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(challenge.period === 'day' ? 'awards.challengePeriodDay' : 'awards.challengePeriodWeek')}
                      </p>
                    </div>
                    <button
                      aria-label={t('awards.challengeDone')}
                      onClick={() => {
                        void markChallengeDone(challenge.id)
                        fireConfetti()
                      }}
                      className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/10 text-success-text"
                    >
                      <Check size={20} />
                    </button>
                    <button
                      aria-label={t('awards.challengeFailed')}
                      onClick={() => void markChallengeFailed(challenge.id)}
                      className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  {progress ? (
                    <div className="space-y-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className={`h-full rounded-full ${progress.met ? 'bg-success' : 'bg-brand-gradient'}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${progress.pct * 100}%` }}
                          transition={{ duration: 0.4, ease: 'easeOut' }}
                        />
                      </div>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {progress.kind === 'day'
                          ? t('awards.challengeProgressDay', {
                              current: progress.current,
                              target: progress.target,
                              unit: progress.unit ?? '',
                            })
                          : t('awards.challengeProgressWeek', {
                              current: progress.current,
                              target: progress.target,
                            })}
                        {progress.met && ` · ${t('awards.challengeMet')}`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('awards.challengeManual')}</p>
                  )}
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
          {doneChallenges > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('awards.challengeCompleted', {
                count: doneChallenges,
                points: doneChallenges * POINTS_PER_CHALLENGE,
              })}
            </p>
          )}
        </section>
      )}

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
                className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-center ${
                  has ? 'border-primary/40 bg-primary/5' : 'border-border bg-card opacity-60'
                }`}
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${has ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground'}`}>
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
