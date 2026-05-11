import { cn } from '@/lib/utils'

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-xl border border-white/10 bg-white/[0.03] p-5', className)}
      role="status"
      aria-label="Loading"
    >
      <div className="mb-3 h-3 w-1/3 rounded bg-white/10" />
      <div className="h-8 w-2/3 rounded bg-white/10" />
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10"
      role="status"
      aria-label="Loading table"
    >
      <div className="grid border-b border-white/10 bg-white/[0.04] p-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-white/10" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid border-b border-white/5 p-3 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-3 animate-pulse rounded bg-white/[0.06]" />
          ))}
        </div>
      ))}
    </div>
  )
}
