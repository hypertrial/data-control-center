import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, MessageSquarePlus, Pencil, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/api/client'
import type { AskConversation } from '@/api/types'
import { formatRelativeTime } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const upd = () => setNarrow(mq.matches)
    upd()
    mq.addEventListener('change', upd)
    return () => mq.removeEventListener('change', upd)
  }, [])
  return narrow
}

function parseUpdatedAt(updatedAt: string): number {
  const ms = Date.parse(updatedAt)
  return Number.isFinite(ms) ? ms : Date.now()
}

function ConversationRow({
  conversation,
  datasetsById,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: AskConversation
  datasetsById: Map<string, string>
  active: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const { data: turns } = useQuery({
    queryKey: ['ask', 'turns', conversation.conversation_id, 'preview'],
    queryFn: () => api.listAskTurns(conversation.conversation_id, 5),
    enabled: hovered,
    staleTime: 60_000,
  })

  const lastTurn = turns?.length ? turns[turns.length - 1] : null
  const status = lastTurn?.error ? 'error' : lastTurn?.answer || lastTurn?.sql ? 'ok' : null
  const turnCount = turns?.length

  const datasetChips =
    conversation.dataset_ids?.slice(0, 2).map((id) => datasetsById.get(id) ?? id) ?? []

  return (
    <div
      className={cn(
        'group relative rounded-lg border border-transparent focus-within:border-border-default',
        active && 'border-border-accent bg-white/10',
      )}
      onMouseEnter={() => setHovered(true)}
      onFocus={() => setHovered(true)}
    >
      <button
        type="button"
        className="w-full rounded-lg px-2 py-2 pr-14 text-left text-sm hover:bg-white/5"
        onClick={onSelect}
      >
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-medium">{conversation.title}</span>
          {status === 'error' ? (
            <span className="shrink-0 rounded-full bg-red-500/20 px-1.5 py-0 text-[9px] font-medium text-red-200">
              Error
            </span>
          ) : status === 'ok' ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0 text-[9px] font-medium text-emerald-200/90">
              OK
            </span>
          ) : null}
          {turnCount != null && turnCount > 0 ? (
            <span className="shrink-0 tabular-nums text-[9px] text-fg-muted">{turnCount}+</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="truncate text-[10px] text-fg-muted">
            {formatRelativeTime(parseUpdatedAt(conversation.updated_at))}
          </span>
          {datasetChips.map((label) => (
            <span
              key={label}
              className="max-w-[5rem] truncate rounded border border-border-default/60 bg-black/20 px-1 text-[9px] text-fg-muted"
              title={label}
            >
              {label}
            </span>
          ))}
        </div>
      </button>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Rename conversation"
          onClick={onRename}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-fg-muted hover:text-[hsl(var(--status-error))]"
          aria-label="Delete conversation"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function ConversationList({
  mobileOpen: controlledMobileOpen,
  onMobileOpenChange,
  hideMobileTrigger = false,
}: {
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
  hideMobileTrigger?: boolean
} = {}) {
  const narrow = useNarrowViewport()
  const qc = useQueryClient()
  const activeId = useUiStore((s) => s.activeConversationId)
  const setActiveId = useUiStore((s) => s.setActiveConversationId)
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [internalMobileOpen, setInternalMobileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

  const mobileOpen = controlledMobileOpen ?? internalMobileOpen
  const setMobileOpen = onMobileOpenChange ?? setInternalMobileOpen

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['ask', 'conversations'],
    queryFn: api.listAskConversations,
  })

  const { data: datasets = [] } = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const datasetsById = useMemo(
    () => new Map(datasets.map((d) => [d.dataset_id, d.name])),
    [datasets],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, search])

  const createMut = useMutation({
    mutationFn: () => api.createAskConversation({}),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
      setActiveId(c.conversation_id)
      setMobileOpen(false)
    },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.patchAskConversation(id, { title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
      setEditing(null)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteAskConversation(id),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
      if (activeId === id) setActiveId(null)
      setConfirmDelete(null)
    },
  })

  const listContent = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Conversations</h2>
          <Tooltip
            content="Chats are saved in the workspace DB. Follow-up questions reuse recent turns for context."
            className="max-w-xs text-xs"
          >
            <button
              type="button"
              className="rounded p-0.5 text-fg-muted hover:bg-white/10 hover:text-fg"
              aria-label="About conversations"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats…"
          className="h-8 pl-7 text-xs"
          aria-label="Search conversations"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {isLoading ? <div className="text-xs text-fg-muted">Loading...</div> : null}
        {filtered.map((c) =>
          editing === c.conversation_id ? (
            <form
              key={c.conversation_id}
              className="flex gap-1 p-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (editTitle.trim()) patchMut.mutate({ id: c.conversation_id, title: editTitle.trim() })
              }}
            >
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-8 text-xs" />
              <Button type="submit" size="sm" className="h-8">
                Save
              </Button>
            </form>
          ) : (
            <ConversationRow
              key={c.conversation_id}
              conversation={c}
              datasetsById={datasetsById}
              active={activeId === c.conversation_id}
              onSelect={() => {
                setActiveId(c.conversation_id)
                setMobileOpen(false)
              }}
              onRename={() => {
                setEditing(c.conversation_id)
                setEditTitle(c.title)
              }}
              onDelete={() => setConfirmDelete({ id: c.conversation_id, title: c.title })}
            />
          ),
        )}
        {!isLoading && filtered.length === 0 ? (
          <p className="px-1 text-xs text-fg-muted">No conversations match your search.</p>
        ) : null}
      </div>
    </>
  )

  const sheet = (
    <Sheet
      open={mobileOpen}
      onOpenChange={setMobileOpen}
      title="Ask conversations"
      className="left-0 right-auto w-[min(100vw,20rem)] max-w-none border-l border-r-0"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listContent}</div>
    </Sheet>
  )

  const deleteDialog = (
    <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
      <DialogContent title="Delete conversation" className="max-w-md">
        <p className="text-sm text-fg-muted">Delete conversation "{confirmDelete?.title}"?</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (narrow) {
    return (
      <>
        {!hideMobileTrigger ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setMobileOpen(true)}>
            Chats
          </Button>
        ) : null}
        {sheet}
        {deleteDialog}
      </>
    )
  }

  return (
    <>
      <aside className="hidden h-full min-h-0 w-56 shrink-0 flex-col border-r border-border-default pr-3 md:flex">
        {listContent}
      </aside>
      {sheet}
      {deleteDialog}
    </>
  )
}
