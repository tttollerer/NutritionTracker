interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </header>
  )
}
