import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Trophy, MessageCircleHeart, User, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

import type { LucideIcon } from 'lucide-react'

interface Tab {
  to: string
  icon: LucideIcon
  key: string
  primary?: boolean
}

const tabs: Tab[] = [
  { to: '/', icon: Home, key: 'today' },
  { to: '/awards', icon: Trophy, key: 'awards' },
  { to: '/add', icon: Plus, key: 'add', primary: true },
  { to: '/coach', icon: MessageCircleHeart, key: 'coach' },
  { to: '/profile', icon: User, key: 'profile' },
]

/** Daumenfreundliche untere Navigation mit zentralem FAB (PLAN.md §8). */
export function BottomTabBar() {
  const { t } = useTranslation()
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md items-center justify-around px-2">
        {tabs.map(({ to, icon: Icon, key, primary }) => (
          <li key={key}>
            <NavLink
              to={to}
              aria-label={t(`nav.${key}`)}
              className="flex min-h-[64px] min-w-[56px] flex-col items-center justify-center gap-1"
            >
              {({ isActive }) =>
                primary ? (
                  <motion.span
                    whileTap={{ scale: 0.88 }}
                    className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                  >
                    <Icon size={28} strokeWidth={2.5} />
                  </motion.span>
                ) : (
                  <motion.span
                    whileTap={{ scale: 0.85 }}
                    className={cn(
                      'flex flex-col items-center gap-0.5 text-[11px]',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                    {t(`nav.${key}`)}
                  </motion.span>
                )
              }
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
