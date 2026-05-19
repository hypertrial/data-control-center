import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown, Settings2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/api/client'
import { saveAskModel, type AskScope } from '@/features/ask/askComposerState'
import type { AskOptionsFocus } from '@/features/ask/askComposerState'
import { cn } from '@/lib/utils'

function truncateName(name: string, max = 32): string {
  if (name.length <= max) return name
  return `${name.slice(0, max - 1)}…`
}

function formatModelSize(size: number | null | undefined): string | null {
  if (size == null || size <= 0) return null
  const gb = size / 1024 ** 3
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`
  const mb = size / 1024 ** 2
  return `${mb.toFixed(0)} MB`
}

function formatModelOptionLabel(
  name: string,
  modelMeta: Map<string, { size: number | null | undefined }>,
): string {
  const sizeLabel = formatModelSize(modelMeta.get(name)?.size)
  return sizeLabel ? `${name} (${sizeLabel})` : name
}

export function AskOptionsPopover({
  open,
  onOpenChange,
  focusSection,
  busy,
  maxRows,
  onMaxRowsChange,
  scope,
  onScopeChange,
  onSelectedModelChange,
  effectiveSelectedModel,
  allIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  focusSection?: AskOptionsFocus | null
  busy: boolean
  maxRows: number
  onMaxRowsChange: (n: number) => void
  scope: AskScope
  onScopeChange: (s: AskScope) => void
  selectedModel: string
  onSelectedModelChange: (model: string) => void
  effectiveSelectedModel: string
  allIds: string[]
}) {
  const focusRef = useRef<HTMLElement | null>(null)
  const { data: datasets = [] } = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const { data: llmModels } = useQuery({
    queryKey: ['llm', 'models'],
    queryFn: api.listLlmModels,
    staleTime: 30_000,
  })

  const modelOptions = useMemo(() => {
    if (!llmModels) return []
    const names = [llmModels.default_model, ...llmModels.models.map((m) => m.name)]
    return [...new Set(names.filter(Boolean))]
  }, [llmModels])

  const modelMeta = useMemo(() => {
    const map = new Map<string, { size: number | null | undefined }>()
    for (const m of llmModels?.models ?? []) {
      map.set(m.name, { size: m.size })
    }
    return map
  }, [llmModels])

  useEffect(() => {
    if (!open || !focusSection) return
    focusRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, focusSection])

  const allChecked = scope === 'all'

  const isDatasetChecked = (id: string) => scope === 'all' || (scope instanceof Set && scope.has(id))

  const setAllDatasets = (checked: boolean) => {
    onScopeChange(checked ? 'all' : new Set(allIds))
  }

  const toggleDataset = (id: string) => {
    onScopeChange((() => {
      if (scope === 'all') {
        const next = new Set(allIds)
        next.delete(id)
        return next
      }
      const next = new Set(scope)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0 || next.size === allIds.length) return 'all'
      return next
    })())
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <Settings2 className="h-3.5 w-3.5" />
          Options
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-2rem))] space-y-4 p-3"
      >
        <section
          ref={focusSection === 'model' ? focusRef : undefined}
          className={cn(focusSection === 'model' && 'rounded-md ring-1 ring-border-accent')}
          data-focus={focusSection === 'model' ? 'true' : undefined}
        >
          <label
            htmlFor="dcc-ask-model"
            className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-fg-muted"
          >
            Model
          </label>
          <div className="relative">
            <select
              id="dcc-ask-model"
              value={effectiveSelectedModel || ''}
              onChange={(e) => {
                onSelectedModelChange(e.target.value)
                saveAskModel(e.target.value)
              }}
              disabled={busy || !llmModels}
              aria-label="Ollama model"
              className="h-8 w-full appearance-none rounded-md border border-border-default bg-black/30 py-1 pl-2 pr-8 text-sm text-white disabled:opacity-60"
            >
              {modelOptions.length ? (
                modelOptions.map((name) => (
                  <option key={name} value={name}>
                    {formatModelOptionLabel(name, modelMeta)}
                  </option>
                ))
              ) : (
                <option value={llmModels?.default_model ?? ''}>
                  {llmModels?.default_model ?? 'Loading models…'}
                </option>
              )}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
            />
          </div>
          {llmModels && !llmModels.reachable && llmModels.detail ? (
            <p className="mt-1.5 text-[11px] text-amber-200/90">{llmModels.detail}</p>
          ) : null}
        </section>

        <section
          ref={focusSection === 'rows' ? focusRef : undefined}
          className={cn(focusSection === 'rows' && 'rounded-md ring-1 ring-border-accent')}
          data-focus={focusSection === 'rows' ? 'true' : undefined}
        >
          <Tooltip
            content="Max rows for the generated SQL preview (bounded by the server)."
            className="max-w-xs text-xs"
          >
            <label htmlFor="dcc-ask-max-rows" className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-fg-muted">
              Max rows in preview
            </label>
          </Tooltip>
          <Input
            id="dcc-ask-max-rows"
            type="number"
            value={maxRows}
            onChange={(e) => onMaxRowsChange(Number(e.target.value) || 0)}
            className="h-8"
          />
        </section>

        {datasets.length > 0 ? (
          <section
            ref={focusSection === 'scope' ? focusRef : undefined}
            className={cn(focusSection === 'scope' && 'rounded-md ring-1 ring-border-accent')}
            data-focus={focusSection === 'scope' ? 'true' : undefined}
          >
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted">Dataset scope</div>
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-white/5">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => setAllDatasets(e.target.checked)}
                className="rounded border-border-default"
              />
              <span className="text-sm">All datasets</span>
            </label>
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {datasets.map((d) => (
                <li key={d.dataset_id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-white/5',
                      !isDatasetChecked(d.dataset_id) && !allChecked && 'opacity-70',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isDatasetChecked(d.dataset_id)}
                      onChange={() => toggleDataset(d.dataset_id)}
                      className="mt-0.5 rounded border-border-default"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" title={d.name}>
                        {truncateName(d.name)}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-fg-muted">{d.dataset_id}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
