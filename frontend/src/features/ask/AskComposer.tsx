import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Settings2, Sparkles, Terminal } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor } from '@/components/ui/popover'
import { api } from '@/api/client'
import { AskOptionsPopover } from '@/features/ask/AskOptionsPopover'
import {
  DEFAULT_ASK_MAX_ROWS,
  deserializeAskScope,
  readSavedAskModel,
  saveAskModel,
  serializeAskScope,
  settingsSummary,
  type AskOptionsFocus,
  type AskScope,
} from '@/features/ask/askComposerState'
import { useUiStore } from '@/store/uiStore'

function looksLikeSql(text: string): boolean {
  const t = text.trimStart().toUpperCase()
  return t.startsWith('SELECT') || t.startsWith('WITH')
}

export function AskComposer({
  busy,
  question,
  onQuestionChange,
  onSend,
  onStop,
  inputRef,
  recallQuestion,
  conversationId,
  questionHistory = [],
  optionsOpen,
  onOptionsOpenChange,
  optionsFocus,
  onOptionsFocusChange,
}: {
  busy: boolean
  question: string
  onQuestionChange: (q: string) => void
  onSend: (payload: {
    question: string
    maxRows: number
    datasetIds: string[] | null
    model: string | null
  }) => void
  onStop: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  recallQuestion?: string | null
  conversationId?: string | null
  questionHistory?: string[]
  optionsOpen: boolean
  onOptionsOpenChange: (open: boolean) => void
  optionsFocus: AskOptionsFocus | null
  onOptionsFocusChange: (focus: AskOptionsFocus | null) => void
}) {
  const prefsKey = conversationId ?? '__draft__'
  const setAskConversationPrefs = useUiStore((s) => s.setAskConversationPrefs)

  const loadPrefs = useCallback((key: string) => {
    const prefs = useUiStore.getState().askConversationPrefs[key]
    return {
      maxRows: prefs?.maxRows ?? DEFAULT_ASK_MAX_ROWS,
      scope: deserializeAskScope(prefs?.scope),
    }
  }, [])

  const [maxRows, setMaxRows] = useState(() => loadPrefs(prefsKey).maxRows)
  const [scope, setScope] = useState<AskScope>(() => loadPrefs(prefsKey).scope)
  const [selectedModel, setSelectedModel] = useState(readSavedAskModel)
  const internalRef = useRef<HTMLTextAreaElement | null>(null)
  const taRef = inputRef ?? internalRef

  const { data: datasets = [] } = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const { data: llmModels } = useQuery({
    queryKey: ['llm', 'models'],
    queryFn: api.listLlmModels,
    staleTime: 30_000,
  })

  const allIds = useMemo(() => datasets.map((d) => d.dataset_id), [datasets])
  const modelOptions = useMemo(() => {
    if (!llmModels) return []
    const names = [llmModels.default_model, ...llmModels.models.map((m) => m.name)]
    return [...new Set(names.filter(Boolean))]
  }, [llmModels])

  const effectiveSelectedModel = useMemo(() => {
    if (!llmModels) return selectedModel
    if (modelOptions.length === 0) return llmModels.default_model
    return selectedModel && modelOptions.includes(selectedModel) ? selectedModel : llmModels.default_model
  }, [llmModels, modelOptions, selectedModel])

  useEffect(() => {
    if (effectiveSelectedModel) saveAskModel(effectiveSelectedModel)
  }, [effectiveSelectedModel])

  useEffect(() => {
    const serialized = serializeAskScope(scope)
    const existing = useUiStore.getState().askConversationPrefs[prefsKey]
    const scopeEqual =
      existing?.scope === serialized ||
      (Array.isArray(existing?.scope) &&
        Array.isArray(serialized) &&
        existing.scope.length === serialized.length &&
        existing.scope.every((id, i) => id === serialized[i]))
    if (existing?.maxRows === maxRows && scopeEqual) return
    setAskConversationPrefs(prefsKey, { maxRows, scope: serialized })
  }, [prefsKey, maxRows, scope, setAskConversationPrefs])

  const resolveDatasetIds = useCallback((): string[] | null => {
    if (scope === 'all') return null
    const arr = [...scope]
    if (arr.length === 0 || arr.length === allIds.length) return null
    return arr
  }, [scope, allIds])

  const submit = () => {
    const q = question.trim()
    if (!q || busy) return
    onSend({
      question: q,
      maxRows: maxRows || 0,
      datasetIds: resolveDatasetIds(),
      model: effectiveSelectedModel || null,
    })
  }

  const openOptions = (focus: AskOptionsFocus | null) => {
    onOptionsFocusChange(focus)
    onOptionsOpenChange(true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault()
      if (busy) onStop()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault()
      openOptions(null)
      return
    }
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

  const settingsLabel = settingsSummary(
    effectiveSelectedModel || 'model…',
    maxRows,
    scope,
    datasets.length,
  )

  const historyItems = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const q of [...questionHistory].reverse()) {
      const t = q.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push(t)
      if (out.length >= 8) break
    }
    return out
  }, [questionHistory])

  return (
    <Popover
      open={optionsOpen}
      onOpenChange={(open) => {
        onOptionsOpenChange(open)
        if (!open) onOptionsFocusChange(null)
      }}
    >
      <div className="sticky bottom-0 z-10 shrink-0 border-t border-border-default bg-surface-1/95 pb-3 pt-3 backdrop-blur md:pt-2">
        <div className="space-y-2">
          {looksLikeSql(question) ? (
            <p className="text-[11px] text-fg-muted">
              This looks like SQL.{' '}
              <Link to="/sql" className="inline-flex items-center gap-0.5 font-medium text-fg underline">
                <Terminal className="h-3 w-3" />
                Use SQL tab
              </Link>{' '}
              for ad-hoc queries.
            </p>
          ) : null}

          <div className="flex items-start gap-2">
            {historyItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Question history"
                  >
                    <History className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-sm">
                  {historyItems.map((q) => (
                    <DropdownMenuItem key={q} className="text-xs" onClick={() => onQuestionChange(q)}>
                      <span className="line-clamp-2">{q}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

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
              rows={2}
              className="min-h-[3.5rem] max-h-60 flex-1 resize-y rounded-xl border border-border-default bg-black/30 px-3 py-2 text-sm text-white placeholder:text-fg-muted focus:border-border-accent focus:outline-none"
            />
            <div className="flex shrink-0 flex-col gap-1.5">
              {busy ? (
                <Button type="button" variant="outline" className="gap-1" onClick={() => onStop()}>
                  Stop
                </Button>
              ) : null}
              <Button
                type="button"
                className="gap-1"
                disabled={busy || !question.trim()}
                onClick={() => submit()}
              >
                <Sparkles className="h-4 w-4" />
                {busy ? 'Streaming…' : 'Ask'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <PopoverAnchor asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 max-w-full gap-1 truncate text-xs font-normal"
                aria-label="Ask settings"
                onClick={() => openOptions(null)}
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{settingsLabel}</span>
              </Button>
            </PopoverAnchor>

            <AskOptionsPopover
              focusSection={optionsFocus}
              busy={busy}
              maxRows={maxRows}
              onMaxRowsChange={setMaxRows}
              scope={scope}
              onScopeChange={setScope}
              onSelectedModelChange={setSelectedModel}
              effectiveSelectedModel={effectiveSelectedModel}
              allIds={allIds}
            />

            <span className="text-[10px] text-fg-muted">
              <kbd className="rounded border border-border-default px-1 font-mono">⌘</kbd>+
              <kbd className="rounded border border-border-default px-1 font-mono">Enter</kbd> send ·{' '}
              <kbd className="rounded border border-border-default px-1 font-mono">↑</kbd> recall ·{' '}
              <kbd className="rounded border border-border-default px-1 font-mono">⌘</kbd>.
              stop
            </span>
          </div>
        </div>
      </div>
    </Popover>
  )
}
