import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ChipProps {
  label: string
  selected: boolean
  onClick: () => void
}

/** Auswahl-Chip für Persona/Ernährungsform/Allergien & Presets. */
export function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'focus-ring min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background text-foreground',
      )}
    >
      {label}
    </motion.button>
  )
}
