import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({
  listDatasets: vi.fn(),
  fetchDatasetProfileOnce: vi.fn(),
  listSavedCharts: vi.fn(),
  listRelationships: vi.fn(),
  verifyRelationship: vi.fn(),
  setRelationshipDecision: vi.fn(),
  deleteRelationshipDecision: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return {
    ...original,
    api: { ...original.api, ...h },
  }
})

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}{location.search}</span>
}

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={['/overview?ds=ds_001']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="*" element={<><LocationProbe /><OverviewPage /></>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const relationship = {
  relationship_id: 'rel_1',
  left: {
    dataset_id: 'ds_001', dataset_name: 'customers.csv', view_name: 'customers',
    column_name: 'customer_id', physical_type: 'BIGINT', semantic_type: 'id_like',
    unique_pct: 100, metric_scope: 'full',
  },
  right: {
    dataset_id: 'ds_002', dataset_name: 'orders.csv', view_name: 'orders',
    column_name: 'customer_id', physical_type: 'BIGINT', semantic_type: 'id_like',
    unique_pct: 50, metric_scope: 'full',
  },
  cardinality: 'one_to_many' as const,
  confidence: 'high' as const,
  reasons: ['Matching column'],
  decision: 'suggested' as const,
  availability: 'ready' as const,
  suggested_sql: 'SELECT * FROM customers JOIN orders USING (customer_id)',
}

describe('OverviewPage', () => {
  beforeEach(() => {
    useUiStore.setState({ activeDatasetId: 'ds_001', pendingAskQuestion: null, pendingQuery: null })
    h.listDatasets.mockResolvedValue([{
      dataset_id: 'ds_001', name: 'customers.csv', view_name: 'customers', source_path: 'customers.csv',
      format: 'csv', row_count: 2, column_count: 2, file_size_bytes: 42,
    }])
    h.fetchDatasetProfileOnce.mockResolvedValue(mkProfile({
      dataset_id: 'ds_001', name: 'Customers', rows: 2, columns: 2,
      narrative: '**Customer records** ready for analysis.', likely_grain: 'one row per customer',
      primary_grain_key_columns: ['customer_id'], main_numeric_measures: ['lifetime_value'],
      entity_id_columns: [
        { name: 'customer_id', confidence: 'high' },
        { name: 'account_code', confidence: 'medium' },
      ],
      profile_metric_warnings: ['Distinct counts use the profile sample.'],
      structure_warnings: ['Grain inference is provisional.'],
      column_profiles: [
        mkColumn({ name: 'customer_id', semantic_type: 'id_like' }),
        mkColumn({ name: 'lifetime_value', semantic_type: 'numeric' }),
      ],
      quality_score: 92,
      quality_issues: [{
        id: 'missing', severity: 'warning', category: 'completeness', title: 'Missing values',
        description: 'Some values are empty.', why_it_matters: 'Totals may be understated.',
        affected_columns: ['lifetime_value'], examples: [], suggested_sql: 'SELECT * FROM customers', score_impact: 8,
      }],
    }))
    h.listSavedCharts.mockResolvedValue([{
      chart_id: 'chart_1', dataset_id: 'ds_001', name: 'Customer value', description: null,
      spec: { version: 4, datasetId: 'ds_001' }, created_at: 'now', updated_at: 'now',
    }])
    h.listRelationships.mockResolvedValue({ relationships: [relationship], pending_dataset_ids: [] })
    h.verifyRelationship.mockResolvedValue({
      relationship_id: 'rel_1', scope: 'sample', left_sample_rows: 2, right_sample_rows: 3,
      left_distinct: 2, right_distinct: 2, overlap_distinct: 2,
      left_match_pct: 100, right_match_pct: 100, verdict: 'strong',
    })
    h.setRelationshipDecision.mockResolvedValue({ ...relationship, decision: 'confirmed' })
    h.deleteRelationshipDecision.mockResolvedValue(undefined)
  })

  it('turns profile metadata into guided actions', async () => {
    const user = userEvent.setup()
    wrap()

    expect(await screen.findByText('Customer records')).toBeInTheDocument()
    expect(screen.getByText('one row per customer')).toBeInTheDocument()
    expect(screen.getByText('92')).toBeInTheDocument()
    expect(screen.getByText('Missing values')).toBeInTheDocument()
    expect(screen.getByText('Customer value')).toBeInTheDocument()
    expect(screen.getByText('Identifier: account_code')).toBeInTheDocument()
    expect(await screen.findByText('Matching column')).toBeInTheDocument()
    expect(screen.getByText(/Distinct counts use the profile sample/)).toBeInTheDocument()
    expect(screen.getByText(/Grain inference is provisional/)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Verify/i }))
    expect(await screen.findByText(/2 shared values/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Confirm/i }))
    await waitFor(() => expect(h.setRelationshipDecision).toHaveBeenCalledWith('rel_1', 'confirmed'))

    await user.click(screen.getByRole('button', { name: /Ask about this dataset/i }))
    expect(useUiStore.getState().pendingAskQuestion).toMatch(/Customers/)
    expect(screen.getByTestId('location')).toHaveTextContent('/ask?ds=ds_001')
  })

  it('hands suggested issue and relationship SQL to the SQL workspace', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Missing values')

    await user.click(await screen.findByRole('button', { name: /Open join SQL/i }))
    expect(useUiStore.getState().pendingQuery).toContain('customers')
    expect(screen.getByTestId('location')).toHaveTextContent('/sql')
  })

  it('explains that the profile is still being prepared', async () => {
    h.fetchDatasetProfileOnce.mockImplementation(() => new Promise(() => {}))
    wrap()

    expect(await screen.findByText('Profiling dataset…')).toBeInTheDocument()
    expect(screen.getByText(/fill in automatically/i)).toBeInTheDocument()
  })
})
