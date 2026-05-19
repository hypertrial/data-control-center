import { Eye, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  COLUMN_TOOLBAR_IDS,
  CQ_OPTIONS,
  SEM_OPTIONS,
} from '@/features/columns/columnsTableConstants'

type ColumnsFiltersProps = {
  activeId: string
  columnSearch: string
  setColumnSearch: (value: string) => void
  semanticFilter: string
  setSemanticFilter: (value: string) => void
  columnQualityFilter: 'all' | 'has_flags' | 'critical_only'
  setColumnQualityFilter: (value: 'all' | 'has_flags' | 'critical_only') => void
  hiddenCols: string[]
  toggleColVis: (datasetId: string, columnId: string) => void
}

export function ColumnsFilters({
  activeId,
  columnSearch,
  setColumnSearch,
  semanticFilter,
  setSemanticFilter,
  columnQualityFilter,
  setColumnQualityFilter,
  hiddenCols,
  toggleColVis,
}: ColumnsFiltersProps) {
  return (
    <div className="rounded-lg border border-border-default bg-white/[0.02] p-3 sm:p-4">
      <div className="mb-3 text-xs font-semibold tracking-tight text-white">Filter columns</div>
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-4 lg:gap-y-3">
        <div className="min-w-[200px] flex-1 lg:max-w-md">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Name contains
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <Input
              placeholder="Column name…"
              value={columnSearch}
              onChange={(e) => setColumnSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="min-w-0 flex-1 lg:min-w-[320px]">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Semantic type
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SEM_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSemanticFilter(opt.value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs transition',
                  semanticFilter === opt.value
                    ? 'bg-white/12 text-white'
                    : 'text-[hsl(var(--muted))] hover:bg-white/5 hover:text-white',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
              Quality
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CQ_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setColumnQualityFilter(opt.value)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition',
                    columnQualityFilter === opt.value
                      ? 'bg-white/12 text-white'
                      : 'text-[hsl(var(--muted))] hover:bg-white/5 hover:text-white',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1">
                <Eye className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Visible in table</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_TOOLBAR_IDS.map(({ id, label }) => (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={!hiddenCols.includes(id)}
                  onCheckedChange={() => toggleColVis(activeId, id)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
