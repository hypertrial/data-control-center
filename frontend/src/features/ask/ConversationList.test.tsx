import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationList } from '@/features/ask/ConversationList'
import { useUiStore } from '@/store/uiStore'

const h = vi.hoisted(() => ({
  listAskConversations: vi.fn(),
  createAskConversation: vi.fn(),
  patchAskConversation: vi.fn(),
  deleteAskConversation: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listAskConversations: h.listAskConversations,
      createAskConversation: h.createAskConversation,
      patchAskConversation: h.patchAskConversation,
      deleteAskConversation: h.deleteAskConversation,
    },
  }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ConversationList', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    h.listAskConversations.mockResolvedValue([
      {
        conversation_id: 'c1',
        title: 'First chat',
        dataset_ids: null,
        created_at: 't',
        updated_at: 't',
      },
    ])
    h.createAskConversation.mockResolvedValue({
      conversation_id: 'c_new',
      title: 'New',
      dataset_ids: null,
      created_at: 't',
      updated_at: 't',
    })
    h.patchAskConversation.mockResolvedValue({
      conversation_id: 'c1',
      title: 'Renamed',
      dataset_ids: null,
      created_at: 't',
      updated_at: 't',
    })
    h.deleteAskConversation.mockResolvedValue(undefined)
    useUiStore.setState({ activeConversationId: null })
  })

  it('lists conversations and selects one', async () => {
    const user = userEvent.setup()
    wrap(<ConversationList />)
    await waitFor(() => expect(screen.getByText('First chat')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /First chat/i }))
    expect(useUiStore.getState().activeConversationId).toBe('c1')
  })

  it('creates a conversation via New', async () => {
    const user = userEvent.setup()
    wrap(<ConversationList />)
    await user.click(screen.getByRole('button', { name: /^New$/ }))
    await waitFor(() => expect(h.createAskConversation).toHaveBeenCalled())
    expect(useUiStore.getState().activeConversationId).toBe('c_new')
  })

  it('renames a conversation', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ activeConversationId: 'c1' })
    wrap(<ConversationList />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename conversation' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Rename conversation' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() =>
      expect(h.patchAskConversation).toHaveBeenCalledWith('c1', { title: 'Renamed' }),
    )
  })

  it('deletes a conversation', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ activeConversationId: 'c1' })
    window.confirm = vi.fn(() => true)
    wrap(<ConversationList />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete conversation' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(h.deleteAskConversation).toHaveBeenCalledWith('c1'))
  })
})
