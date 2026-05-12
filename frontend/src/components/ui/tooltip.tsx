import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({
  children,
  content,
  className,
  sideOffset = 4,
}: {
  children: React.ReactNode
  content: React.ReactNode
  className?: string
  sideOffset?: number
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={sideOffset}
          className={cn(
            'z-[100] max-w-sm rounded-md border border-border-default bg-surface-elevated px-2 py-1 text-xs text-fg shadow-md',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-elevated" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
