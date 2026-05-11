import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RelationshipsPage } from '@/features/relationships/RelationshipsPage'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

const h = vi.hoisted(() => ({
  relationships: vi.fn(),
  refreshRelationships: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      relationships: h.relationships,
      refreshRelationships: h.refreshRelationships,
    },
  }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('RelationshipsPage', () => {
  it('loading', () => {
    h.relationships.mockImplementation(() => new Promise(() => {}))
    wrap(<RelationshipsPage />)
    expect(screen.getByText(/Loading relationships/)).toBeInTheDocument()
  })

  it('error', async () => {
    h.relationships.mockRejectedValue(new Error('re'))
    wrap(<RelationshipsPage />)
    await waitFor(() => expect(screen.getByText('re')).toBeInTheDocument())
  })

  it('renders rows', async () => {
    h.relationships.mockResolvedValue([
      {
        left_dataset_id: 'a',
        left_column: 'x',
        right_dataset_id: 'b',
        right_column: 'y',
        score: 0.9,
        evidence: 'ev',
      },
    ])
    wrap(<RelationshipsPage />)
    await waitFor(() => expect(screen.getByText('ev')).toBeInTheDocument())
  })

  it('refresh discovery triggers relationships refresh', async () => {
    const user = userEvent.setup()
    h.relationships.mockResolvedValue([
      {
        left_dataset_id: 'a',
        left_column: 'x',
        right_dataset_id: 'b',
        right_column: 'y',
        score: 0.9,
        evidence: 'ev',
      },
    ])
    h.refreshRelationships.mockResolvedValue([])
    wrap(<RelationshipsPage />)
    await waitFor(() => expect(screen.getByText('ev')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /refresh discovery/i }))
    expect(h.refreshRelationships).toHaveBeenCalledTimes(1)
  })
})
