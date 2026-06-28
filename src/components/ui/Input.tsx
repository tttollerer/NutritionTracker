import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-[48px] w-full rounded-xl border border-input bg-background px-3 text-base outline-none ring-ring focus:ring-2',
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
