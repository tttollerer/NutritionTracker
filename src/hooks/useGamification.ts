import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import confetti from 'canvas-confetti'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import { useTodayKey } from '@/hooks/useTodayKey'
import {
  BADGES,
  companionFrom,
  computeStats,
  earnedFreezeTokens,
  POINTS_PER_CHALLENGE,
  type GamiStats,
} from '@/lib/gamification'
import { evaluateActiveChallenges, type ChallengeView } from '@/lib/challenges'
import type { Achievement } from '@/db/types'

export interface GamificationView {
  stats: GamiStats
  unlocked: Set<string>
  companion: { type: string; stage: number; mood: 'happy' | 'ok' | 'sad' }
  freezeTokens: number
  todaySuccess: boolean
  /** Aktive Challenges mit (falls rule auswertbar) Fortschritt. */
  challenges: ChallengeView[]
  /** Abgeschlossene Challenges — geben je POINTS_PER_CHALLENGE Punkte. */
  doneChallenges: number
}

export function fireConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, scalar: 0.9 })
}

/**
 * Wertet die Gamification reaktiv aus, persistiert Änderungen idempotent und
 * feiert neue Badges / Level-Ups mit Konfetti (PLAN.md §9).
 *
 * Streak-Freeze: verdiente Tokens = earnedFreezeTokens(geloggte Tage), Verbrauch
 * wird als `frozenDates` (überbrückte Lückentage) im GamificationState
 * persistiert — derselbe Lückentag kostet dadurch nie zweimal ein Token.
 */
export function useGamification(opts: { celebrate?: boolean } = {}): GamificationView | undefined {
  const { celebrate = false } = opts
  const logs = useLiveQuery(() => db.logs.filter((l) => !l.deletedAt).toArray(), [])
  const foods = useLiveQuery(() => db.foods.toArray(), [])
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  const achievements = useLiveQuery(() => db.achievements.toArray(), [])
  const challenges = useLiveQuery(() => db.challenges.toArray(), [])
  // null = geladen, aber noch kein Zustand vorhanden (undefined = lädt noch).
  const gamiState = useLiveQuery(async () => (await db.gamification.get('me')) ?? null, [])

  const prevLevel = useRef<number | null>(null)
  const prevBadges = useRef<number | null>(null)

  const ready = logs && foods && goals && achievements && challenges && gamiState !== undefined
  const today = useTodayKey() // reaktiv über Mitternacht (Befund 1)

  // Reaktive Auswertung (rein).
  const computed = ready
    ? (() => {
        const frozen = new Set(gamiState?.frozenDates ?? [])
        const distinctDays = new Set(logs!.map((l) => l.date)).size
        const available = Math.max(0, earnedFreezeTokens(distinctDays) - frozen.size)
        const doneChallenges = challenges!.filter((c) => c.status === 'done').length
        const stats = computeStats(logs!, goals!, today, {
          bonusPoints: doneChallenges * POINTS_PER_CHALLENGE,
          freeze: { available, frozenDates: frozen },
        })
        const sources = new Set(foods!.map((f) => f.source))
        const unlocked = new Set(BADGES.filter((b) => b.predicate(stats, { sources })).map((b) => b.key))
        const todayStatus = stats.byDate[today]
        const companion = companionFrom(stats.overallStreak, !!todayStatus?.success, !!todayStatus)
        const challengeViews = evaluateActiveChallenges(challenges!, logs!, today)
        return {
          stats,
          unlocked,
          companion,
          doneChallenges,
          challengeViews,
          // In diesem Lauf verbrauchte Tokens sofort abziehen — die Persistenz
          // im Effekt zieht per frozenDates nach.
          freezeTokens: Math.max(0, available - stats.frozenUsed.length),
          nextFrozen: [...frozen, ...stats.frozenUsed],
          earned: earnedFreezeTokens(distinctDays),
        }
      })()
    : null

  // Persistenz + Feier als Seiteneffekt — nur in der globalen Engine-Instanz.
  useEffect(() => {
    if (!celebrate || !computed || !achievements) return
    const existing = new Set(achievements.map((a) => a.key))
    const newly = [...computed.unlocked].filter((k) => !existing.has(k))

    void (async () => {
      if (newly.length) {
        const rows: Achievement[] = newly.map((key) => ({
          id: crypto.randomUUID(),
          key,
          unlockedAt: Date.now(),
        }))
        await db.achievements.bulkPut(rows)
      }

      const cur = await db.gamification.get('me')
      // Frisch aus der DB mergen, damit parallel persistierte frozenDates
      // nicht verloren gehen; Verbrauch bleibt idempotent (Set-Union).
      const frozenDates = [...new Set([...(cur?.frozenDates ?? []), ...computed.nextFrozen])]
      const next = {
        id: 'me' as const,
        points: computed.stats.points,
        level: computed.stats.level,
        streaks: { overall: computed.stats.overallStreak },
        freezeTokens: Math.max(0, computed.earned - frozenDates.length),
        frozenDates,
        unlocked: [...computed.unlocked],
        companion: computed.companion,
        updatedAt: Date.now(),
      }
      if (
        !cur ||
        cur.points !== next.points ||
        cur.level !== next.level ||
        cur.streaks.overall !== next.streaks.overall ||
        cur.freezeTokens !== next.freezeTokens ||
        (cur.frozenDates?.length ?? 0) !== next.frozenDates.length ||
        cur.companion?.stage !== next.companion.stage ||
        cur.companion?.mood !== next.companion.mood
      ) {
        await db.gamification.put(next)
      }

      // Feiern – aber nicht beim allerersten Laden.
      const leveledUp = prevLevel.current != null && computed.stats.level > prevLevel.current
      const gotBadge = prevBadges.current != null && computed.unlocked.size > prevBadges.current
      if (leveledUp || gotBadge) fireConfetti()
      prevLevel.current = computed.stats.level
      prevBadges.current = computed.unlocked.size
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    computed?.stats.points,
    computed?.stats.overallStreak,
    computed?.stats.frozenUsed.length,
    computed?.freezeTokens,
    computed?.unlocked.size,
    achievements?.length,
  ])

  if (!computed) return undefined
  return {
    stats: computed.stats,
    unlocked: computed.unlocked,
    companion: computed.companion,
    freezeTokens: computed.freezeTokens,
    todaySuccess: !!computed.stats.byDate[today]?.success,
    challenges: computed.challengeViews,
    doneChallenges: computed.doneChallenges,
  }
}
