import * as React from 'react'
import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-border-default bg-white/5',
        critical:
          'border-[hsl(var(--severity-critical)/0.45)] bg-[hsl(var(--severity-critical)/0.12)] text-red-100',
        warning:
          'border-[hsl(var(--severity-warning)/0.45)] bg-[hsl(var(--severity-warning)/0.12)] text-amber-50',
        info: 'border-[hsl(var(--severity-info)/0.45)] bg-[hsl(var(--severity-info)/0.12)] text-sky-50',
        ok: 'border-[hsl(var(--severity-ok)/0.45)] bg-[hsl(var(--severity-ok)/0.12)] text-emerald-100',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
