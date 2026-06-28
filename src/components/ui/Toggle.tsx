import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  icon?: React.ReactNode
  label: string
  hint?: string
}

/** Schalter-Zeile für aktivierbare Module/Einstellungen. */
export function Toggle({ checked, onChange, icon, label, hint }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between gap-3 p-4 text-left"
    >
      <span className="flex items-center gap-3">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span>
          <span className="block">{label}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
      </span>
      <span
        className={cn(
          'flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <motion.span layout className="h-6 w-6 rounded-full bg-white shadow" style={{ marginLeft: checked ? 'auto' : 0 }} />
      </span>
    </button>
  )
}
