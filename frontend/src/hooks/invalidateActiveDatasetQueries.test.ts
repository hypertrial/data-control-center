import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { invalidateActiveDatasetQueries } from '@/hooks/invalidateActiveDatasetQueries'

describe('invalidateActiveDatasetQueries', () => {
  it('invalidates all per-dataset query keys', () => {
    const qc = new QueryClient()
    const invalidateQueries = vi.spyOn(qc, 'invalidateQueries')

    invalidateActiveDatasetQueries(qc, 'ds_001')

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile', 'ds_001'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['quality', 'ds_001'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile-history', 'ds_001'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile-diff', 'ds_001'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sample', 'ds_001'] })
    expect(invalidateQueries).toHaveBeenCalledTimes(5)
  })
})
