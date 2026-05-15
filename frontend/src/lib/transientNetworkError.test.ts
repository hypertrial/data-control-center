import { describe, expect, it } from 'vitest'
import { isTransientNetworkError } from '@/lib/transientNetworkError'

describe('isTransientNetworkError', () => {
  it('is false for non-errors', () => {
    expect(isTransientNetworkError(null)).toBe(false)
    expect(isTransientNetworkError('nope')).toBe(false)
  })

  it('detects AbortError by name', () => {
    const e = new Error('cancelled')
    e.name = 'AbortError'
    expect(isTransientNetworkError(e)).toBe(true)
  })

  it('detects common browser / proxy fetch failures', () => {
    expect(isTransientNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(isTransientNetworkError(new Error('NetworkError when attempting to fetch'))).toBe(true)
    expect(isTransientNetworkError(new Error('Load failed'))).toBe(true)
  })

  it('is false for API body errors', () => {
    expect(isTransientNetworkError(new Error('{"detail":"not found"}'))).toBe(false)
  })
})
