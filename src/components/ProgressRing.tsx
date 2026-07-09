import { motion } from 'framer-motion'

interface ProgressRingProps {
  value: number
  max: number
  size?: number
  stroke?: number
  label?: string
  sublabel?: string
  /**
   * Überschreitungs-Zustand (Befund 7): Ring + Sublabel wechseln auf den
   * destructive-Token, damit „über Ziel" nicht wie 100 % Erfolg aussieht.
   * Additiv — ohne Prop bleibt alles wie bisher.
   */
  over?: boolean
}

/** Animierter Fortschrittsring für Kalorien/Makros (PLAN.md §8). */
export function ProgressRing({
  value,
  max,
  size = 180,
  stroke = 14,
  label,
  sublabel,
  over = false,
}: ProgressRingProps) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = max > 0 ? Math.min(value / max, 1) : 0

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--ring-track))"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={over ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        {label && <span className="text-3xl font-bold tabular-nums">{label}</span>}
        {sublabel && (
          <span className={`text-sm ${over ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  )
}
