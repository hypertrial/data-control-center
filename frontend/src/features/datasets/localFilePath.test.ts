import { describe, expect, it } from 'vitest'
import { resolveLocalFilePath } from '@/features/datasets/localFilePath'

describe('resolveLocalFilePath', () => {
  it('returns the host path when present on the File object', () => {
    const file = new File(['db'], 'a.duckdb')
    Object.defineProperty(file, 'path', { value: '/data/a.duckdb' })
    expect(resolveLocalFilePath(file)).toBe('/data/a.duckdb')
  })

  it('returns null when the browser hides the path', () => {
    expect(resolveLocalFilePath(new File(['db'], 'a.duckdb'))).toBeNull()
  })
})
