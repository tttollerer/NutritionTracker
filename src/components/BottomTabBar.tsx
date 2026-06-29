import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Trophy, MessageCircleHeart, User, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useOverlays } from '@/lib/overlays-context'

import type { LucideIcon } from 'lucide-react'

interface Tab {
  to: string
  icon: LucideIcon
  key: string
}

const tabs: Tab[] = [
  { to: '/', icon: Home, key: 'today' },
  { to: '/awards', icon: Trophy, key: 'awards' },
  { to: '/coach', icon: MessageCircleHeart, key: 'coach' },
  { to: '/profile', icon: User, key: 'profile' },
]

/** Daumenfreundliche untere Navigation mit zentralem FAB (PLAN.md §8). */
export function BottomTabBar() {
  const { t } = useTranslation()
  const { openCapture } = useOverlays()
  // Linke zwei Tabs, dann der FAB (öffnet das Erfass-Quick-Sheet), dann rechte zwei.
  const left = tabs.slice(0, 2)
  const right = tabs.slice(2)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md items-center justify-around px-2">
        {left.map((tab) => (
          <TabItem key={tab.key} tab={tab} />
        ))}
        <li>
          <button
            onClick={openCapture}
            aria-label={t('add.title')}
            className="flex min-h-[64px] min-w-[56px] flex-col items-center justify-center"
          >
            <motion.span
              whileTap={{ scale: 0.88 }}
              className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30"
            >
              <Plus size={28} strokeWidth={2.5} />
            </motion.span>
          </button>
        </li>
        {right.map((tab) => (
          <TabItem key={tab.key} tab={tab} />
        ))}
      </ul>
    </nav>
  )
}

function TabItem({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  const Icon = tab.icon
  return (
    <li>
      <NavLink
        to={tab.to}
        aria-label={t(`nav.${tab.key}`)}
        className="flex min-h-[64px] min-w-[56px] flex-col items-center justify-center gap-1"
      >
        {({ isActive }) => (
          <motion.span
            whileTap={{ scale: 0.85 }}
            className={cn('flex flex-col items-center gap-0.5 text-[11px]', isActive ? 'text-primary' : 'text-muted-foreground')}
          >
            <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
            {t(`nav.${tab.key}`)}
          </motion.span>
        )}
      </NavLink>
    </li>
  )
}
