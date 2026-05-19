import type { ReactNode } from 'react'
import {
  Calendar,
  CaseSensitive,
  Hash,
  HelpCircle,
  KeyRound,
  Tags,
  ToggleLeft,
} from 'lucide-react'
import type { SemanticType } from '@/api/types'
import { cn } from '@/lib/utils'

export function TypeIcon({ sem }: { sem: SemanticType }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted))]'
  const wrap = (label: string, node: ReactNode) => (
    <span title={label} className="inline-flex">
      {node}
    </span>
  )
  switch (sem) {
    case 'numeric':
      return wrap('Numeric', <Hash className={cls} aria-hidden />)
    case 'categorical':
      return wrap('Categorical', <Tags className={cls} aria-hidden />)
    case 'datetime':
      return wrap('Datetime', <Calendar className={cls} aria-hidden />)
    case 'boolean_like':
      return wrap('Boolean-like', <ToggleLeft className={cls} aria-hidden />)
    case 'id_like':
      return wrap('ID-like', <KeyRound className={cls} aria-hidden />)
    case 'text':
      return wrap('Text', <CaseSensitive className={cls} aria-hidden />)
    default:
      return wrap('Unknown', <HelpCircle className={cls} aria-hidden />)
  }
}

export function NullBar({ pct }: { pct: number }) {
  const warm = pct > 30 ? 'bg-[hsl(var(--severity-critical))]' : pct > 10 ? 'bg-[hsl(var(--severity-warning))]' : 'bg-[hsl(var(--severity-info))]'
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10" title={`${pct.toFixed(2)}% null`}>
        <div className={cn('h-full rounded-full transition-all', warm)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tabular-nums text-xs text-[hsl(var(--muted))]">{pct.toFixed(1)}</span>
    </div>
  )
}
