import { useCallback, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api/client'
import { Tooltip } from '@/components/ui/tooltip'

type Scope = 'all' | Set<string>

export function AskComposer({
  busy,
  question,
  onQuestionChange,
  onSend,
  onStop,
  inputRef,
  recallQuestion,
}: {
  busy: boolean
  question: string
  onQuestionChange: (q: string) => void
  onSend: (payload: { question: string; maxRows: number; datasetIds: string[] | null }) => void
  onStop: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  recallQuestion?: string | null
}) {
  const [maxRows, setMaxRows] = useState(200)
  const [scope, setScope] = useState<Scope>('all')
  const internalRef = useRef<HTMLTextAreaElement | null>(null)
  const taRef = inputRef ?? internalRef

  const { data: datasets = [] } = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })

  const allIds = useMemo(() => datasets.map((d) => d.dataset_id), [datasets])

  const resolveDatasetIds = useCallback((): string[] | null => {
    if (scope === 'all') return null
    const arr = [...scope]
    if (arr.length === 0 || arr.length === allIds.length) return null
    return arr
  }, [scope, allIds])

  const toggleDataset = (id: string) => {
    setScope((s) => {
      if (s === 'all') {
        const next = new Set(allIds)
        next.delete(id)
        return next
      }
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0 || next.size === allIds.length) return 'all'
      return next
    })
  }

  const submit = () => {
    const q = question.trim()
    if (!q || busy) return
    onSend({ question: q, maxRows: maxRows || 0, datasetIds: resolveDatasetIds() })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && busy) {
      e.preventDefault()
      onStop()
      return
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !question.trim() && recallQuestion) {
      e.preventDefault()
      onQuestionChange(recallQuestion)
      return
    }
    if (e.key !== 'Enter') return
    if (!e.metaKey && !e.ctrlKey) return
    e.preventDefault()
    submit()
  }

  return (
    <div className="sticky bottom-0 z-10 border-t border-border-default bg-surface-1/95 pb-3 pt-3 backdrop-blur md:border-t-0 md:pt-2">
      <div className="space-y-2">
        <label htmlFor="dcc-ask-q" className="sr-only">
          Question
        </label>
        <textarea
          id="dcc-ask-q"
          ref={taRef}
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question about your data in plain language…"
          rows={4}
          className="w-full resize-y rounded-xl border border-border-default bg-black/30 px-3 py-2 text-sm text-white placeholder:text-fg-muted focus:border-border-accent focus:outline-none"
        />

        {datasets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={scope === 'all' ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setScope('all')}
            >
              All datasets
            </Button>
            <span className="text-[10px] text-fg-muted">Toggle scope:</span>
            {datasets.map((d) => {
              const active =
                scope === 'all' || (scope instanceof Set && scope.has(d.dataset_id))
              return (
                <Button
                  key={d.dataset_id}
                  type="button"
                  variant={active ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 max-w-[10rem] truncate text-xs"
                  onClick={() => toggleDataset(d.dataset_id)}
                  title={d.name}
                >
                  {d.dataset_id}
                </Button>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <Tooltip
            content="Max rows for the generated SQL preview (bounded by the server)."
            className="max-w-xs text-xs"
          >
            <div className="min-w-[120px]">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Result row limit
              </div>
              <Input
                type="number"
                value={maxRows}
                onChange={(e) => setMaxRows(Number(e.target.value) || 0)}
              />
            </div>
          </Tooltip>
          <Button
            type="button"
            className="gap-1"
            disabled={busy || !question.trim()}
            onClick={() => submit()}
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Streaming…' : 'Ask (stream)'}
          </Button>
          {busy ? (
            <Button type="button" variant="outline" onClick={() => onStop()}>
              Stop (Esc)
            </Button>
          ) : null}
          <span className="text-[10px] text-fg-muted">
            <kbd className="rounded border border-border-default px-1 font-mono">⌘</kbd>+
            <kbd className="rounded border border-border-default px-1 font-mono">Enter</kbd> send ·{' '}
            <kbd className="rounded border border-border-default px-1 font-mono">↑</kbd> recall
          </span>
        </div>
      </div>
    </div>
  )
}
