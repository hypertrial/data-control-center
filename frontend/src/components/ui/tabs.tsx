import * as React from 'react'
import { cn } from '@/lib/utils'

type TabsContext = {
  value: string
  onValueChange: (v: string) => void
}

const TabsCtx = React.createContext<TabsContext | null>(null)

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string
  onValueChange: (v: string) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <TabsCtx.Provider value={{ value, onValueChange }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsCtx.Provider>
  )
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center gap-1 rounded-lg border border-border-default bg-surface-1/80 p-1',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string
  className?: string
  children: React.ReactNode
}) {
  const ctx = React.useContext(TabsCtx)
  if (!ctx) throw new Error('TabsTrigger outside Tabs')
  const active = ctx.value === value
  return (
    <button
      type="button"
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm transition',
        active ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string
  className?: string
  children: React.ReactNode
}) {
  const ctx = React.useContext(TabsCtx)
  if (!ctx) throw new Error('TabsContent outside Tabs')
  const active = ctx.value === value
  return (
    <div
      role="tabpanel"
      hidden={!active}
      aria-hidden={!active}
      className={cn('mt-4', !active && 'hidden', className)}
    >
      {children}
    </div>
  )
}
