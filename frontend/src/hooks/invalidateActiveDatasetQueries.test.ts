import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  invalidateActiveDatasetQueries,
  removeActiveDatasetQueries,
} from '@/hooks/invalidateActiveDatasetQueries'

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
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['relationships', 'ds_001'] })
    expect(invalidateQueries).toHaveBeenCalledTimes(6)
  })

  it('optionally invalidates the dataset list', () => {
    const qc = new QueryClient()
    const invalidateQueries = vi.spyOn(qc, 'invalidateQueries')

    invalidateActiveDatasetQueries(qc, 'ds_001', { includeDatasets: true })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['datasets'] })
    expect(invalidateQueries).toHaveBeenCalledTimes(7)
  })

  it('removes all per-dataset query keys', () => {
    const qc = new QueryClient()
    const removeQueries = vi.spyOn(qc, 'removeQueries')

    removeActiveDatasetQueries(qc, 'ds_001')

    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['profile', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['quality', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['profile-history', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['profile-diff', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['sample', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['relationships', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['saved-charts', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['dataset-dependencies', 'ds_001'] })
    expect(removeQueries).toHaveBeenCalledTimes(8)
  })
})
