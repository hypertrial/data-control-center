import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { expectToken, installApiClientTestSession, jsonOk } from '@/test/apiClient'

installApiClientTestSession()

describe('api client facade', () => {
  it('health calls /api/health without protected token bootstrap', async () => {
    const body = {
      status: 'ok',
      llm: { reachable: false, model: 'qwen3:4b', detail: 'offline' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonOk(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.health()).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { credentials: 'include' })
  })

  it('listLlmModels calls protected /api/llm/models', async () => {
    const body = {
      default_model: 'qwen3:4b',
      models: [{ name: 'qwen3:4b', modified_at: null, size: null }],
      reachable: true,
      detail: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonOk(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.listLlmModels()).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/llm/models', expect.any(Object))
    expectToken(fetchMock.mock.calls[0]![1] as RequestInit)
  })
})
