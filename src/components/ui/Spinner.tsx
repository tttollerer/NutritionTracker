import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Die eine gemeinsame Ladeanzeige der App (statt lokaler Framer-/Loader2-Varianten).
 *  CSS-`animate-spin` respektiert prefers-reduced-motion über die globale Regel in index.css.
 *  Farbe erbt vom Kontext (`currentColor`) oder wird per className (z. B. text-primary) gesetzt. */
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} aria-hidden="true" className={cn('animate-spin', className)} />
}
