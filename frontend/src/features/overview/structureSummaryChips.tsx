import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ChipRole = 'date' | 'entity' | 'grain' | 'measure'

const chipRoleClass: Record<ChipRole, string> = {
  date: 'border-[hsl(var(--accent-cyan)/0.45)] bg-[hsl(var(--accent-cyan)/0.10)]',
  entity: 'border-[hsl(var(--accent)/0.45)] bg-[hsl(var(--accent)/0.10)]',
  grain: 'border-[hsl(var(--accent-orange)/0.45)] bg-[hsl(var(--accent-orange)/0.10)]',
  measure: 'border-[hsl(var(--accent-green)/0.45)] bg-[hsl(var(--accent-green)/0.10)]',
}

export function chipCols(
  label: string,
  cols: string[],
  onPick: (c: string) => void,
  opts?: { maxItems?: number; role?: ChipRole },
): ReactNode {
  if (!cols.length) return null
  const max = opts?.maxItems
  const shown = max != null ? cols.slice(0, max) : cols
  const overflow = max != null ? cols.slice(max) : []
  const chipClass = opts?.role ? chipRoleClass[opts.role] : 'border-border-default bg-white/[0.04]'
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <span className="mt-1 min-w-[6.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--fg-muted))]">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {shown.map((c) => (
          <button
            key={c}
            type="button"
            className={cn(
              'max-w-full truncate rounded-md border px-2 py-0.5 text-left font-mono text-xs text-white/90 hover:bg-white/10',
              chipClass,
            )}
            title={c}
            onClick={() => onPick(c)}
          >
            {c}
          </button>
        ))}
        {overflow.length > 0 ? (
          <span
            className="self-center rounded-md border border-border-default bg-white/[0.03] px-2 py-0.5 text-xs text-[hsl(var(--fg-muted))]"
            title={overflow.join(', ')}
          >
            +{overflow.length} more
          </span>
        ) : null}
      </div>
    </div>
  )
}
