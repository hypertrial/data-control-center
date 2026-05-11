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
        'inline-flex h-10 items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1',
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
        active ? 'bg-white/10 text-white' : 'text-[hsl(var(--muted))] hover:text-white',
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
  if (ctx.value !== value) return null
  return <div className={cn('mt-4', className)}>{children}</div>
}
