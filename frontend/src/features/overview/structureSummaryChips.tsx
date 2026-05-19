import type { ReactNode } from 'react'

export function chipCols(
  label: string,
  cols: string[],
  onPick: (c: string) => void,
  opts?: { maxItems?: number },
): ReactNode {
  if (!cols.length) return null
  const max = opts?.maxItems
  const shown = max != null ? cols.slice(0, max) : cols
  const overflow = max != null ? cols.slice(max) : []
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <span className="mt-1 min-w-[6.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {shown.map((c) => (
          <button
            key={c}
            type="button"
            className="max-w-full truncate rounded-md border border-border-default bg-white/[0.04] px-2 py-0.5 text-left font-mono text-xs text-white/90 hover:bg-white/10"
            title={c}
            onClick={() => onPick(c)}
          >
            {c}
          </button>
        ))}
        {overflow.length > 0 ? (
          <span
            className="self-center rounded-md border border-border-default bg-white/[0.03] px-2 py-0.5 text-xs text-[hsl(var(--muted))]"
            title={overflow.join(', ')}
          >
            +{overflow.length} more
          </span>
        ) : null}
      </div>
    </div>
  )
}
