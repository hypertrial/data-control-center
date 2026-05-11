import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RelationshipsPage } from '@/features/relationships/RelationshipsPage'

const h = vi.hoisted(() => ({ relationships: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, relationships: h.relationships } }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
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
})
