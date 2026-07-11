interface PageHeaderProps {
  title: string
  /** Optionale Unterzeile (z. B. Datum „Do, 10. Juli" oder ein antippbarer Wochenbereich). */
  subtitle?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <header className="mb-4 flex items-start justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  )
}
