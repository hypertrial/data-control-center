import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { useUiStore } from '@/store/uiStore'

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function AskPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const openInSql = useOpenInSql()
  const [question, setQuestion] = useState('')
  const [maxRows, setMaxRows] = useState(200)

  const mut = useMutation({
    mutationFn: () =>
      api.askAgent({
        question: question.trim(),
        dataset_ids: activeId ? [activeId] : null,
        max_rows: maxRows || null,
      }),
  })

  const result = mut.data
  const scopeHint = useMemo(() => {
    if (activeId) return `Using schema context for the active dataset (${activeId}).`
    return 'Using schema context for all registered datasets.'
  }, [activeId])

  const onQuestionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (!e.metaKey && !e.ctrlKey) return
    e.preventDefault()
    if (!question.trim() || mut.isPending) return
    mut.mutate()
  }

  return (
    <PageContainer>
      <p className="text-xs text-[hsl(var(--muted))]">
        {scopeHint} Press{' '}
        <kbd className="rounded border border-white/20 px-1 font-mono text-[10px]">⌘</kbd>+
        <kbd className="rounded border border-white/20 px-1 font-mono text-[10px]">Enter</kbd> to ask.
      </p>

      <div className="grid gap-3 lg:grid-cols-[1fr_140px]">
        <div>
          <label htmlFor="dcc-ask-q" className="sr-only">
            Question
          </label>
          <textarea
            id="dcc-ask-q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onQuestionKeyDown}
            placeholder="Ask a question about your data in plain language…"
            rows={5}
            className="w-full resize-y rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-[hsl(var(--muted))] focus:border-white/25 focus:outline-none"
          />
        </div>
        <div className="space-y-2">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
              max_rows
            </div>
            <Input
              type="number"
              value={maxRows}
              onChange={(e) => setMaxRows(Number(e.target.value) || 0)}
            />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={mut.isPending || !question.trim()}
            onClick={() => mut.mutate()}
          >
            Ask
          </Button>
        </div>
      </div>

      {mut.isPending && <p className="text-sm text-[hsl(var(--muted))]">Thinking…</p>}
      {mut.isError && (
        <QueryErrorBanner message={(mut.error as Error).message} />
      )}

      {result?.error && !result.answer && (
        <QueryErrorBanner message={result.error} />
      )}

      {result?.answer && (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted))]">
            Answer
          </div>
          <div className="prose prose-invert prose-sm mt-2 max-w-none [&_p]:my-2 [&_ul]:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
          </div>
        </div>
      )}

      {(result?.explanation || result?.sql) && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-4">
          {result.explanation ? (
            <div>
              <div className="text-xs font-semibold text-[hsl(var(--muted))]">Model note</div>
              <p className="mt-1 text-sm text-white/90">{result.explanation}</p>
            </div>
          ) : null}
          {result.sql ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[hsl(var(--muted))]">Generated SQL</span>
                <Button type="button" variant="outline" size="sm" onClick={() => openInSql(result.sql!)}>
                  Open in SQL
                </Button>
              </div>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/90">
                {result.sql}
              </pre>
            </div>
          ) : null}
          <p className="text-[10px] text-[hsl(var(--muted))]">Model: {result.model}</p>
        </div>
      )}

      {result?.query_result &&
        !result.query_result.error &&
        result.query_result.columns.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-[hsl(var(--muted))]">
              <span className="tabular-nums">{result.query_result.row_count}</span> rows
              {result.query_result.truncated ? ' (truncated)' : ''}
            </div>
            <Table>
              <caption className="sr-only">Agent query result</caption>
              <THead>
                <TR>
                  {result.query_result.columns.map((c) => (
                    <TH key={c.name} scope="col">
                      {c.name}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {result.query_result.rows.map((row, i) => (
                  <TR key={i}>
                    {result.query_result!.columns.map((c) => (
                      <TD key={c.name} className="max-w-[200px] truncate font-mono text-xs">
                        {formatCell(row[c.name])}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}

      {result?.query_result?.error && (
        <QueryErrorBanner message={result.query_result.error} />
      )}
    </PageContainer>
  )
}
