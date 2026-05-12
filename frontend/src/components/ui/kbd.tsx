import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent)
}

export function ModKey() {
  return <>{isMacPlatform() ? '⌘' : 'Ctrl'}</>
}

export function Kbd({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <kbd
      className={cn(
        'rounded border border-border-default bg-surface-2/80 px-1 font-mono text-[10px] text-fg-soft',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
