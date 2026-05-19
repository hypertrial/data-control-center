import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

/** Anchor matches README (see root README.md). */
const LLM_SETUP_DOC =
  'https://github.com/hypertrial/data-control-center/blob/main/README.md#local-llm-assistant-ask-tab'

export function LlmStatusBanner() {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  if (!data?.llm || data.llm.reachable) return null

  return (
    <div
      role="status"
      className="shrink-0 rounded-lg border border-border-default bg-bg-elevated/60 px-3 py-2 text-sm text-fg-muted"
    >
      <p>
        Ollama is not reachable at the configured endpoint, so{' '}
        <strong className="text-fg">Ask</strong> may not work. Overview, Columns, Quality, Samples, and SQL are
        unaffected.
      </p>
      <p className="mt-1">
        <a
          href={LLM_SETUP_DOC}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-fg underline decoration-border-default underline-offset-2 hover:decoration-fg"
        >
          Local LLM setup (README)
        </a>
        {' · '}
        Configured model: <span className="font-mono text-xs">{data.llm.model}</span>
      </p>
      {data.llm.detail ? (
        <p className="mt-1 font-mono text-xs text-fg-muted/90" title={data.llm.detail}>
          {data.llm.detail}
        </p>
      ) : null}
    </div>
  )
}
