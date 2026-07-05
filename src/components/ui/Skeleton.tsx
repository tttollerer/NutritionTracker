import { cn } from '@/lib/utils'

/** Konsistenter Lade-Platzhalter statt Spinner (PLAN.md §8). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-md', className)} />
}
