import { describe, expect, it } from 'vitest'
import {
  filterDuckDbFiles,
  filterSupportedFiles,
  hasIngestibleFiles,
  hasTabularIngestibleFiles,
  partitionIncomingFiles,
  TABULAR_ACCEPT_ATTR,
} from '@/features/datasets/uploadFiles'

describe('uploadFiles', () => {
  it('tabular accept excludes duckdb', () => {
    expect(TABULAR_ACCEPT_ATTR).not.toContain('duckdb')
  })

  it('partitions data and duckdb files', () => {
    const csv = new File(['a'], 'a.csv')
    const duck = new File(['b'], 'b.duckdb')
    const other = new File(['c'], 'c.exe')
    const { dataFiles, duckDbFiles } = partitionIncomingFiles([csv, duck, other])
    expect(dataFiles.map((f) => f.name)).toEqual(['a.csv'])
    expect(duckDbFiles.map((f) => f.name)).toEqual(['b.duckdb'])
  })

  it('filters supported data extensions only', () => {
    const files = filterSupportedFiles([
      new File(['a'], 'a.csv'),
      new File(['b'], 'b.duckdb'),
      new File(['c'], 'c.exe'),
    ])
    expect(files.map((f) => f.name)).toEqual(['a.csv'])
  })

  it('filters duckdb files only', () => {
    const files = filterDuckDbFiles([new File(['a'], 'a.csv'), new File(['b'], 'b.duckdb')])
    expect(files.map((f) => f.name)).toEqual(['b.duckdb'])
  })

  it('reports ingestible when data or duckdb present', () => {
    expect(hasIngestibleFiles([new File(['a'], 'a.csv')])).toBe(true)
    expect(hasIngestibleFiles([new File(['b'], 'b.duckdb')])).toBe(true)
    expect(hasIngestibleFiles([new File(['c'], 'c.exe')])).toBe(false)
  })

  it('reports tabular ingestible only for data files', () => {
    expect(hasTabularIngestibleFiles([new File(['a'], 'a.csv')])).toBe(true)
    expect(hasTabularIngestibleFiles([new File(['b'], 'b.duckdb')])).toBe(false)
  })
})
