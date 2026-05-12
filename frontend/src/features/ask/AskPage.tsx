import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageContainer } from '@/components/ui/section'
import { AskComposer } from '@/features/ask/AskComposer'
import { AskThread } from '@/features/ask/AskThread'
import { ConversationList } from '@/features/ask/ConversationList'
import { SuggestedPrompts } from '@/features/ask/SuggestedPrompts'
import { useAskStream } from '@/hooks/useAskStream'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { api } from '@/api/client'
import { useUiStore } from '@/store/uiStore'

export function AskPage() {
  const qc = useQueryClient()
  const activeDatasetId = useUiStore((s) => s.activeDatasetId)
  const activeConversationId = useUiStore((s) => s.activeConversationId)
  const setActiveConversationId = useUiStore((s) => s.setActiveConversationId)
  const openInSql = useOpenInSql()

  const { busy, current, run, cancel } = useAskStream()
  const [streamQuestion, setStreamQuestion] = useState<string | null>(null)
  const [composerText, setComposerText] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const prevBusy = useRef(false)

  const { data: turns = [] } = useQuery({
    queryKey: ['ask', 'turns', activeConversationId],
    queryFn: () => api.listAskTurns(activeConversationId!, 100),
    enabled: !!activeConversationId,
  })

  const { data: profile } = useQuery({
    queryKey: ['profile', activeDatasetId],
    queryFn: () => api.getProfile(activeDatasetId!),
    enabled: !!activeDatasetId,
  })

  useEffect(() => {
    if (current?.error) toast.error(current.error)
  }, [current?.error])

  useEffect(() => {
    void taRef.current?.focus()
  }, [])

  useEffect(() => {
    if (prevBusy.current && !busy && current?.turnId && activeConversationId) {
      void qc.invalidateQueries({ queryKey: ['ask', 'turns', activeConversationId] })
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
      setComposerText('')
    }
    prevBusy.current = busy
  }, [busy, current?.turnId, activeConversationId, qc])

  const recallLastQuestion = turns.length ? turns[turns.length - 1]!.question : null

  const ensureConversation = async () => {
    if (activeConversationId) return activeConversationId
    const c = await api.createAskConversation({})
    void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
    setActiveConversationId(c.conversation_id)
    return c.conversation_id
  }

  const onSend = async (payload: { question: string; maxRows: number; datasetIds: string[] | null }) => {
    setStreamQuestion(payload.question)
    try {
      const cid = await ensureConversation()
      await run({
        question: payload.question,
        dataset_ids: payload.datasetIds,
        max_rows: payload.maxRows || null,
        conversation_id: cid,
        use_history: true,
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onRetry = (q: string) => {
    void onSend({ question: q, maxRows: 200, datasetIds: null })
  }

  return (
    <PageContainer className="flex h-full min-h-0 flex-col space-y-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden md:flex-row md:items-stretch">
        <ConversationList />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="shrink-0 text-xs text-fg-muted">
            Chats are saved in the workspace DB. Follow-up questions reuse recent turns for context.
          </div>

          {profile && (!activeConversationId || turns.length === 0) ? (
            <div className="shrink-0">
              <SuggestedPrompts profile={profile} onPick={setComposerText} />
            </div>
          ) : null}

          <AskThread
            conversationId={activeConversationId}
            turns={turns}
            streamingQuestion={streamQuestion}
            streaming={current}
            busy={busy}
            onOpenInSql={openInSql}
            onRetry={onRetry}
          />

          <AskComposer
            busy={busy}
            question={composerText}
            onQuestionChange={setComposerText}
            onSend={onSend}
            onStop={cancel}
            inputRef={taRef}
            recallQuestion={recallLastQuestion}
          />
        </div>
      </div>
    </PageContainer>
  )
}
