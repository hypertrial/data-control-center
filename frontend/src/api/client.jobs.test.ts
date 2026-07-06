import { describe, expect, it, vi } from 'vitest'
import { api, fetchDatasetProfileOnce, nextJobPollIntervalMs } from '@/api/client'
import { expectToken, installApiClientTestSession, jsonOk } from '@/test/apiClient'

installApiClientTestSession()

describe('job and profile api client', () => {
  it('nextJobPollIntervalMs caps backoff', () => {
    expect(nextJobPollIntervalMs(0)).toBe(1200)
    expect(nextJobPollIntervalMs(3)).toBe(8000)
  })

  it('fetchDatasetProfileOnce throws PROFILE_NOT_READY without polling', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              code: 'PROFILE_NOT_READY',
              message: 'Profiling',
              details: { job_id: 'j1' },
            },
          }),
        ),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchDatasetProfileOnce('ds_1')).rejects.toMatchObject({
      code: 'PROFILE_NOT_READY',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/datasets/ds_1/profile'),
      expect.any(Object),
    )
  })

  it('fetchDatasetProfile polls job when profile is not ready', async () => {
    vi.useFakeTimers()
    const profile = { dataset_id: 'ds_1' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                code: 'PROFILE_NOT_READY',
                message: 'Profiling',
                details: { job_id: 'j1' },
              },
            }),
          ),
      } as Response)
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'running', kind: 'profile_refresh' }))
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'completed', kind: 'profile_refresh' }))
      .mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        text: () => Promise.resolve(JSON.stringify(profile)),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const pending = api.fetchDatasetProfile('ds_1')
    await vi.advanceTimersByTimeAsync(4000)
    await expect(pending).resolves.toEqual(profile)
    vi.useRealTimers()
  })

  it('fetchDatasetProfile surfaces failed, timed out, and aborted polling', async () => {
    vi.useFakeTimers()
    const failingFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(JSON.stringify({
          error: { code: 'PROFILE_NOT_READY', message: 'Profiling', details: { job_id: 'j1' } },
        })),
      } as Response)
      .mockResolvedValueOnce(jsonOk({
        job_id: 'j1',
        status: 'failed',
        kind: 'profile_refresh',
        error_message: 'boom',
        error_code: 'JOB_FAILED',
      }))
    vi.stubGlobal('fetch', failingFetch)
    const failed = expect(api.fetchDatasetProfile('ds_1')).rejects.toMatchObject({
      name: 'ApiRequestError',
      code: 'JOB_FAILED',
      message: 'boom',
    })
    await vi.advanceTimersByTimeAsync(1200)
    await failed

    const timeoutFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(JSON.stringify({
          error: { code: 'PROFILE_NOT_READY', message: 'Profiling', details: { job_id: 'j1' } },
        })),
      } as Response)
      .mockResolvedValue(jsonOk({ job_id: 'j1', status: 'running', kind: 'profile_refresh' }))
    vi.stubGlobal('fetch', timeoutFetch)
    const timedOut = expect(api.fetchDatasetProfile('ds_1', { timeoutMs: 1500, pollIntervalMs: 500 }))
      .rejects.toMatchObject({ name: 'ApiRequestError', code: 'JOB_POLL_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(2000)
    await timedOut

    const abortFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(JSON.stringify({
          error: { code: 'PROFILE_NOT_READY', message: 'Profiling', details: { job_id: 'j1' } },
        })),
      } as Response)
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'running', kind: 'profile_refresh' }))
    vi.stubGlobal('fetch', abortFetch)
    const controller = new AbortController()
    const aborted = expect(api.fetchDatasetProfile('ds_1', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await vi.advanceTimersByTimeAsync(1200)
    await aborted
    vi.useRealTimers()
  })

  it('job endpoints use expected paths and methods', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ dataset_id: 'ds_1' }))
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'queued' }))
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'completed' }))
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'completed' }))
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'canceled' }))
    vi.stubGlobal('fetch', fetchMock)

    await api.refreshProfile('ds_1')
    await api.getJob('j1')
    await api.listJobs()
    await expect(api.waitForJob('j1', { timeoutMs: 100 })).resolves.toMatchObject({
      job_id: 'j1',
      status: 'completed',
    })
    await api.cancelJob('j1')

    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/profile/refresh', {
      credentials: 'include',
      headers: expect.any(Headers),
      method: 'POST',
    })
    expectToken(fetchMock.mock.calls[0]![1] as RequestInit)
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/j1', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs?limit=100', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/j1/cancel', expect.objectContaining({ method: 'POST' }))
  })
})
