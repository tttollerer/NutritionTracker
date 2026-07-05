import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground',
  ghost: 'bg-transparent text-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm',
}

interface ButtonProps extends ComponentProps<typeof motion.button> {
  variant?: Variant
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      className={cn(
        'focus-ring inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
