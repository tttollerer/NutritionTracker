import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import confetti from 'canvas-confetti'
import { db } from '@/db'
import { getActiveGoalsMap } from '@/db/repo'
import { todayKey } from '@/lib/utils'
import {
  BADGES,
  companionFrom,
  computeStats,
  type GamiStats,
} from '@/lib/gamification'
import type { Achievement } from '@/db/types'

export interface GamificationView {
  stats: GamiStats
  unlocked: Set<string>
  companion: { type: string; stage: number; mood: 'happy' | 'ok' | 'sad' }
  freezeTokens: number
  todaySuccess: boolean
}

function fireConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, scalar: 0.9 })
}

/**
 * Wertet die Gamification reaktiv aus, persistiert Änderungen idempotent und
 * feiert neue Badges / Level-Ups mit Konfetti (PLAN.md §9).
 */
export function useGamification(opts: { celebrate?: boolean } = {}): GamificationView | undefined {
  const { celebrate = false } = opts
  const logs = useLiveQuery(() => db.logs.filter((l) => !l.deletedAt).toArray(), [])
  const foods = useLiveQuery(() => db.foods.toArray(), [])
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  const achievements = useLiveQuery(() => db.achievements.toArray(), [])

  const prevLevel = useRef<number | null>(null)
  const prevBadges = useRef<number | null>(null)

  const ready = logs && foods && goals && achievements
  const today = todayKey()

  // Reaktive Auswertung (rein).
  const computed = ready
    ? (() => {
        const stats = computeStats(logs!, goals!, today)
        const sources = new Set(foods!.map((f) => f.source))
        const unlocked = new Set(BADGES.filter((b) => b.predicate(stats, { sources })).map((b) => b.key))
        const todayStatus = stats.byDate[today]
        const companion = companionFrom(stats.overallStreak, !!todayStatus?.success, !!todayStatus)
        return { stats, unlocked, companion }
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

      const freezeTokens = 1 + Math.floor(computed.stats.overallStreak / 7)
      const cur = await db.gamification.get('me')
      const next = {
        id: 'me' as const,
        points: computed.stats.points,
        level: computed.stats.level,
        streaks: { overall: computed.stats.overallStreak },
        freezeTokens: Math.max(cur?.freezeTokens ?? 0, freezeTokens),
        unlocked: [...computed.unlocked],
        companion: computed.companion,
        updatedAt: Date.now(),
      }
      if (
        !cur ||
        cur.points !== next.points ||
        cur.level !== next.level ||
        cur.streaks.overall !== next.streaks.overall ||
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
  }, [computed?.stats.points, computed?.stats.overallStreak, computed?.unlocked.size, achievements?.length])

  if (!computed) return undefined
  return {
    stats: computed.stats,
    unlocked: computed.unlocked,
    companion: computed.companion,
    freezeTokens: 1 + Math.floor(computed.stats.overallStreak / 7),
    todaySuccess: !!computed.stats.byDate[today]?.success,
  }
}
