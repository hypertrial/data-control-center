import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { api } from '@/api/client'
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

export function ConversationList() {
  const narrow = useNarrowViewport()
  const qc = useQueryClient()
  const activeId = useUiStore((s) => s.activeConversationId)
  const setActiveId = useUiStore((s) => s.setActiveConversationId)
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['ask', 'conversations'],
    queryFn: api.listAskConversations,
  })

  const createMut = useMutation({
    mutationFn: () => api.createAskConversation({}),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['ask', 'conversations'] })
      setActiveId(c.conversation_id)
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
    },
  })

  const listContent = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Conversations</h2>
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
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {isLoading ? <div className="text-xs text-fg-muted">Loading…</div> : null}
        {conversations.map((c) => (
          <div
            key={c.conversation_id}
            className={cn(
              'group relative rounded-lg border border-transparent',
              activeId === c.conversation_id && 'border-border-accent bg-white/10',
            )}
          >
            {editing === c.conversation_id ? (
              <form
                className="flex gap-1 p-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (editTitle.trim()) patchMut.mutate({ id: c.conversation_id, title: editTitle.trim() })
                }}
              >
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button type="submit" size="sm" className="h-8">
                  Save
                </Button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5"
                  onClick={() => {
                    setActiveId(c.conversation_id)
                    setMobileOpen(false)
                  }}
                >
                  <div className="truncate font-medium">{c.title}</div>
                  <div className="truncate text-[10px] text-fg-muted">{c.conversation_id}</div>
                </button>
                <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Rename conversation"
                    onClick={() => {
                      setEditing(c.conversation_id)
                      setEditTitle(c.title)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-fg-muted hover:text-[hsl(var(--status-error))]"
                    aria-label="Delete conversation"
                    onClick={() => {
                      if (window.confirm(`Delete conversation “${c.title}”?`)) {
                        deleteMut.mutate(c.conversation_id)
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )

  if (narrow) {
    return (
      <>
        <Button type="button" variant="outline" size="sm" onClick={() => setMobileOpen(true)}>
          Chats
        </Button>
        <Sheet
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          title="Ask conversations"
          className="left-0 right-auto w-[min(100vw,20rem)] max-w-none border-l border-r-0"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listContent}</div>
        </Sheet>
      </>
    )
  }

  return (
    <aside className="hidden min-h-0 w-56 shrink-0 flex-col border-r border-border-default pr-3 md:flex">
      {listContent}
    </aside>
  )
}
