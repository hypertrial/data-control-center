import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { sql as sqlLang } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import type { AskTurn as AskTurnType, QueryResult } from '@/api/types'
import { AskResultTable } from '@/features/ask/AskResultTable'
import { stripTrailingLimit } from '@/features/ask/askTableUtils'
import { AskStageTimeline } from '@/features/ask/AskStageTimeline'
import type { AskSqlAttempt, AskStageEntry } from '@/hooks/useAskStream'
import { toast } from 'sonner'

function SqlBlock({
  sql,
  onOpenInSql,
}: {
  sql: string
  onOpenInSql: (sql: string) => void
}) {
  const extensions = useMemo(
    () => [
      vscodeDark,
      sqlLang(),
      EditorView.editable.of(false),
      EditorView.theme({
        '&': { backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
    [],
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-muted">Generated SQL</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenInSql(sql)}>
            Open in SQL
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenInSql(stripTrailingLimit(sql))}
          >
            Open without LIMIT
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(sql)
              toast.success('SQL copied')
            }}
          >
            Copy
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border-default">
        <CodeMirror
          value={sql}
          height="120px"
          theme="none"
          extensions={extensions}
          editable={false}
          className="text-xs [&_.cm-editor]:rounded-lg"
          basicSetup={{ lineNumbers: true, foldGutter: false }}
        />
      </div>
    </div>
  )
}

function adaptAttemptsToTimeline(attempts: Record<string, unknown>[]): AskSqlAttempt[] {
  const out: AskSqlAttempt[] = []
  let i = 0
  for (const a of attempts) {
    i += 1
    const sqlStr = typeof a.sql === 'string' ? a.sql : ''
    const err =
      typeof a.error === 'string' ? a.error : a.error != null ? String(a.error) : 'error'
    const att = typeof a.attempt === 'number' ? a.attempt : i
    out.push({ sql: sqlStr, error: err, attempt: att })
  }
  return out
}

export function AskTurnCard({
  turn,
  onOpenInSql,
  onRetry,
}: {
  turn: AskTurnType
  onOpenInSql: (sql: string) => void
  onRetry?: (question: string) => void
}) {
  const attempts = adaptAttemptsToTimeline(turn.attempts ?? [])
  const stages: AskStageEntry[] =
    attempts.length > 0
      ? [
          { name: 'context', at: 0 },
          { name: 'draft_sql', at: 0 },
          { name: 'execute', at: 0 },
          { name: 'summarize', at: 0 },
        ]
      : []

  const displayAnswer = turn.answer ?? ''

  return (
    <div className="space-y-3 rounded-xl border border-border-default bg-white/[0.04] p-4">
      <div className="rounded-lg bg-black/25 px-3 py-2 text-sm text-white/95">{turn.question}</div>
      {attempts.length > 0 ? (
        <AskStageTimeline
          stages={stages}
          sqlAttempts={attempts}
          totalMs={turn.elapsed_ms ?? null}
          busy={false}
        />
      ) : null}
      {turn.error ? <QueryErrorBanner message={turn.error} /> : null}
      {turn.sql ? <SqlBlock sql={turn.sql} onOpenInSql={onOpenInSql} /> : null}
      {turn.query_result && !turn.query_result.error ? (
        <AskResultTable queryResult={turn.query_result} />
      ) : null}
      {turn.query_result?.error ? <QueryErrorBanner message={turn.query_result.error} /> : null}
      {displayAnswer ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Answer</div>
          <div className="prose prose-invert prose-sm mt-2 max-w-none [&_p]:my-2 [&_ul]:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayAnswer}</ReactMarkdown>
          </div>
        </div>
      ) : null}
      {turn.error && onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onRetry(turn.question)}>
          Retry
        </Button>
      ) : null}
      {turn.model ? <p className="text-[10px] text-fg-muted">Model: {turn.model}</p> : null}
    </div>
  )
}

export function StreamingAskCard({
  question,
  busy,
  stages,
  sqlAttempts,
  sql,
  explanation,
  queryResult,
  answer,
  error,
  streamingPreview,
  model,
  totalMs,
  onOpenInSql,
  onRetry,
}: {
  question: string
  busy: boolean
  stages: AskStageEntry[]
  sqlAttempts: AskSqlAttempt[]
  sql: string | null
  explanation: string | null
  queryResult: QueryResult | null
  answer: string | null
  error: string | null
  streamingPreview: string
  model: string | null
  totalMs: number | null
  onOpenInSql: (sql: string) => void
  onRetry?: (q: string) => void
}) {
  const displayAnswer = answer || streamingPreview || ''
  return (
    <div
      className="space-y-3 rounded-xl border border-border-default border-dashed bg-white/[0.06] p-4"
      aria-busy={busy}
    >
      <div className="rounded-lg bg-black/25 px-3 py-2 text-sm text-white/95">{question}</div>
      {(busy || stages.length > 0) && (
        <AskStageTimeline stages={stages} sqlAttempts={sqlAttempts} totalMs={totalMs} busy={busy} />
      )}
      {explanation ? (
        <div>
          <div className="text-xs font-semibold text-fg-muted">Model note</div>
          <p className="mt-1 text-sm text-white/90">{explanation}</p>
        </div>
      ) : null}
      {error ? <QueryErrorBanner message={error} /> : null}
      {sql ? <SqlBlock sql={sql} onOpenInSql={onOpenInSql} /> : null}
      {queryResult && !queryResult.error ? <AskResultTable queryResult={queryResult} /> : null}
      {queryResult?.error ? <QueryErrorBanner message={queryResult.error} /> : null}
      {displayAnswer ? (
        <div
          role="region"
          aria-live="polite"
          className="rounded-lg border border-border-default/50 bg-black/20 p-3"
        >
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Answer</div>
          <div className="prose prose-invert prose-sm mt-2 max-w-none [&_p]:my-2 [&_ul]:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayAnswer}</ReactMarkdown>
          </div>
        </div>
      ) : null}
      {error && onRetry && !busy ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onRetry(question)}>
          Retry
        </Button>
      ) : null}
      {model ? <p className="text-[10px] text-fg-muted">Model: {model}</p> : null}
    </div>
  )
}
