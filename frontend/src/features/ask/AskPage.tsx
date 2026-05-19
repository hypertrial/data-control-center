import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageContainer } from '@/components/ui/section'
import { AskComposer } from '@/features/ask/AskComposer'
import { AskContextBar } from '@/features/ask/AskContextBar'
import { AskFollowUps } from '@/features/ask/AskFollowUps'
import { AskHero } from '@/features/ask/AskHero'
import { LlmStatusBanner } from '@/features/ask/LlmStatusBanner'
import { AskThread } from '@/features/ask/AskThread'
import { AskThreadSkeleton } from '@/features/ask/AskThreadSkeleton'
import { ConversationList } from '@/features/ask/ConversationList'
import { SuggestedPrompts } from '@/features/ask/SuggestedPrompts'
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  deserializeAskScope,
  type AskOptionsFocus,
} from '@/features/ask/askComposerState'
import { buildFollowUps, isPersistedStreamingTurn } from '@/features/ask/askTurnDisplay'
import { useAskStream } from '@/hooks/useAskStream'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { api } from '@/api/client'
import type { AskTurn } from '@/api/types'
import { useUiStore } from '@/store/uiStore'

export function AskPage() {
  const qc = useQueryClient()
  const activeDatasetId = useUiStore((s) => s.activeDatasetId)
  const activeConversationId = useUiStore((s) => s.activeConversationId)
  const setActiveConversationId = useUiStore((s) => s.setActiveConversationId)
  const pushAskErrorTurn = useUiStore((s) => s.pushAskErrorTurn)
  const clearAskErrorsMatchingQuestion = useUiStore((s) => s.clearAskErrorsMatchingQuestion)
  const recentErrorsByConversation = useUiStore((s) => s.recentErrorsByConversation)
  const openInSql = useOpenInSql()

  const { busy, current, run, cancel } = useAskStream()
  const [streamQuestion, setStreamQuestion] = useState<string | null>(null)
  const [composerText, setComposerText] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [optionsFocus, setOptionsFocus] = useState<AskOptionsFocus | null>(null)
  const [conversationsMobileOpen, setConversationsMobileOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const prevBusy = useRef(false)
  const lastSubmittedQuestion = useRef<string | null>(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['ask', 'conversations'],
    queryFn: api.listAskConversations,
  })

  const {
    data: turns = [],
    isLoading: turnsLoading,
    isFetching: turnsFetching,
  } = useQuery({
    queryKey: ['ask', 'turns', activeConversationId],
    queryFn: () => api.listAskTurns(activeConversationId!, 100),
    enabled: !!activeConversationId,
  })

  const { data: profile, dataUpdatedAt: profileUpdatedAt, refresh: refreshProfile, isPendingProfile } =
    useDatasetProfile(activeDatasetId)

  const { data: datasets = [] } = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })

  const createConversationMut = useMutation({
    mutationFn: () => api.createAskConversation({}),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
      setActiveConversationId(c.conversation_id)
    },
  })

  const mergedTurns: AskTurn[] = useMemo(() => {
    const localErrors = activeConversationId
      ? (recentErrorsByConversation[activeConversationId] ?? [])
      : []
    const persistedQuestions = new Set(turns.map((t) => t.question))
    const synthetic: AskTurn[] = localErrors
      .filter((e) => !persistedQuestions.has(e.question))
      .map((e) => ({
        turn_id: e.id,
        conversation_id: activeConversationId!,
        seq: -1,
        question: e.question,
        error: e.error,
        attempts: [],
        model: e.model ?? null,
        created_at: new Date(e.createdAt).toISOString(),
      }))
    return [...turns, ...synthetic]
  }, [turns, recentErrorsByConversation, activeConversationId])

  const prefsKey = activeConversationId ?? '__draft__'
  const storedPrefs = useUiStore((s) => s.askConversationPrefs[prefsKey])
  const scope = deserializeAskScope(storedPrefs?.scope)
  const maxRows = storedPrefs?.maxRows ?? 200

  useEffect(() => {
    if (current?.error) toast.error(current.error)
  }, [current?.error])

  useEffect(() => {
    void taRef.current?.focus()
  }, [])

  useEffect(() => {
    if (prevBusy.current && !busy && activeConversationId) {
      void qc.invalidateQueries({ queryKey: ['ask', 'turns', activeConversationId] })
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })

      if (current?.error && !current.turnId && lastSubmittedQuestion.current) {
        pushAskErrorTurn(activeConversationId, {
          id: `err-${Date.now()}`,
          question: lastSubmittedQuestion.current,
          error: current.error,
          model: current.model,
          createdAt: Date.now(),
        })
      }

      if (current?.turnId && lastSubmittedQuestion.current) {
        clearAskErrorsMatchingQuestion(activeConversationId, lastSubmittedQuestion.current)
      }

      const conv = conversations.find((c) => c.conversation_id === activeConversationId)
      const titleIsDefault = !conv || conv.title === DEFAULT_CONVERSATION_TITLE
      if (current?.turnId && turns.length === 0 && titleIsDefault && lastSubmittedQuestion.current) {
        const title = deriveConversationTitle(lastSubmittedQuestion.current)
        void api.patchAskConversation(activeConversationId, { title }).then(() => {
          void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
        })
      }

      setComposerText('')
    }
    prevBusy.current = busy
  }, [
    busy,
    current?.turnId,
    current?.error,
    turns.length,
    current?.model,
    activeConversationId,
    conversations,
    qc,
    pushAskErrorTurn,
    clearAskErrorsMatchingQuestion,
  ])

  const streamPersisted = isPersistedStreamingTurn(turns, current?.turnId)

  const showStreaming =
    current &&
    streamQuestion &&
    !streamPersisted &&
    (busy ||
      current.answer ||
      current.error ||
      current.sql ||
      current.queryResult ||
      current.stages.length > 0)

  const showHero =
    !showStreaming &&
    !busy &&
    mergedTurns.length === 0 &&
    (!activeConversationId || (!turnsLoading && !turnsFetching))

  const recallLastQuestion = mergedTurns.length ? mergedTurns[mergedTurns.length - 1]!.question : null

  const questionHistory = useMemo(
    () => mergedTurns.map((t) => t.question),
    [mergedTurns],
  )

  const lastTurnForFollowUps = useMemo(() => {
    if (showStreaming || busy) return null
    const persisted = [...turns].reverse().find((t) => t.answer || t.sql)
    return persisted ?? null
  }, [turns, showStreaming, busy])

  const followUps = useMemo(
    () => (lastTurnForFollowUps && profile ? buildFollowUps(lastTurnForFollowUps, profile) : []),
    [lastTurnForFollowUps, profile],
  )

  const ensureConversation = async () => {
    if (activeConversationId) return activeConversationId
    const c = await api.createAskConversation({})
    void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
    setActiveConversationId(c.conversation_id)
    return c.conversation_id
  }

  const onSend = async (payload: {
    question: string
    maxRows: number
    datasetIds: string[] | null
    model: string | null
  }) => {
    lastSubmittedQuestion.current = payload.question
    setStreamQuestion(payload.question)
    try {
      const cid = await ensureConversation()
      await run({
        question: payload.question,
        dataset_ids: payload.datasetIds,
        max_rows: payload.maxRows || null,
        conversation_id: cid,
        use_history: true,
        model: payload.model,
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onRetry = (q: string, model?: string | null) => {
    void onSend({ question: q, maxRows, datasetIds: null, model: model ?? null })
  }

  const handleOpenSettings = useCallback((focus: AskOptionsFocus | null) => {
    setOptionsFocus(focus)
    setOptionsOpen(true)
  }, [])

  const { data: llmModels } = useQuery({
    queryKey: ['llm', 'models'],
    queryFn: api.listLlmModels,
    staleTime: 30_000,
  })

  const modelLabel =
    current?.model ??
    llmModels?.default_model ??
    'model…'

  return (
    <PageContainer className="flex h-full min-h-0 flex-col space-y-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden md:flex-row md:items-stretch">
        <ConversationList
          mobileOpen={conversationsMobileOpen}
          onMobileOpenChange={setConversationsMobileOpen}
          hideMobileTrigger
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <LlmStatusBanner />

          <AskContextBar
            hidden={showHero}
            modelLabel={modelLabel}
            maxRows={maxRows}
            scope={scope}
            datasetCount={datasets.length}
            profileUpdatedAt={profileUpdatedAt}
            onOpenSettings={handleOpenSettings}
            onRefreshProfile={() => void refreshProfile()}
            refreshDisabled={!activeDatasetId || isPendingProfile}
            showChatsButton
            onOpenChats={() => setConversationsMobileOpen(true)}
          />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {turnsLoading && activeConversationId ? <AskThreadSkeleton /> : null}

            {showHero ? (
              <AskHero
                profile={profile}
                onPickPrompt={setComposerText}
                onStartNewChat={() => createConversationMut.mutate()}
              />
            ) : (
              <AskThread
                conversationId={activeConversationId}
                turns={mergedTurns}
                streamingQuestion={streamPersisted ? null : streamQuestion}
                streaming={streamPersisted ? null : current}
                busy={busy}
                onOpenInSql={openInSql}
                onRetry={onRetry}
                onDeleteTurn={async (turnId) => {
                  if (!activeConversationId) return
                  if (turnId.startsWith('err-')) {
                    useUiStore.getState().removeAskErrorTurn(activeConversationId, turnId)
                    return
                  }
                  await api.deleteAskTurn(activeConversationId, turnId)
                  void qc.invalidateQueries({ queryKey: ['ask', 'turns', activeConversationId] })
                }}
              />
            )}

            {!showHero && followUps.length > 0 ? (
              <AskFollowUps prompts={followUps} onPick={setComposerText} />
            ) : null}

            {!showHero && profile ? (
              <SuggestedPrompts
                profile={profile}
                onPick={setComposerText}
                collapsed={mergedTurns.length > 0}
                compact
              />
            ) : null}

            <AskComposer
              key={prefsKey}
              busy={busy}
              question={composerText}
              onQuestionChange={setComposerText}
              onSend={onSend}
              onStop={cancel}
              inputRef={taRef}
              recallQuestion={recallLastQuestion}
              conversationId={activeConversationId}
              questionHistory={questionHistory}
              optionsOpen={optionsOpen}
              onOptionsOpenChange={setOptionsOpen}
              optionsFocus={optionsFocus}
              onOptionsFocusChange={setOptionsFocus}
            />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
