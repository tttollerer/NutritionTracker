import { cn } from '@/lib/utils'

/** Konsistenter Lade-Platzhalter statt Spinner (PLAN.md §8). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}
