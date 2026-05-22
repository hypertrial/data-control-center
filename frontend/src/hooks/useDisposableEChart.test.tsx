import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'

const disposeMock = vi.fn()
const setOptionMock = vi.fn()
const initMock = vi.fn(() => ({
  setOption: setOptionMock,
  resize: vi.fn(),
  dispose: disposeMock,
}))

vi.mock('echarts', () => ({
  init: (...args: unknown[]) =>
    Reflect.apply(initMock as (...a: unknown[]) => ReturnType<typeof initMock>, undefined, args),
}))

function Harness({
  enabled,
  marker = 0,
  register,
}: {
  enabled?: boolean
  marker?: number
  register?: Parameters<typeof useDisposableEChart>[4]
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDisposableEChart(ref, enabled ?? true, () => ({ series: [{ data: [marker] }] }), [marker], register)
  return <div ref={ref} data-testid="chart-root" />
}

describe('useDisposableEChart', () => {
  beforeEach(() => {
    initMock.mockClear()
    disposeMock.mockClear()
    setOptionMock.mockClear()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '',
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('initializes chart when enabled and disposes on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<Harness />)

    expect(initMock).toHaveBeenCalled()

    const resizeEntry = addSpy.mock.calls.find((c) => c[0] === 'resize')
    expect(resizeEntry?.[1]).toEqual(expect.any(Function))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('resize', resizeEntry![1])
    expect(disposeMock).toHaveBeenCalledTimes(1)
  })

  it('runs register cleanup before dispose', () => {
    const registerCleanup = vi.fn()
    const register = vi.fn(() => registerCleanup)

    vi.spyOn(window, 'addEventListener').mockImplementation(() => {})
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {})

    const { unmount } = render(<Harness register={register} />)

    expect(register).toHaveBeenCalled()

    unmount()

    expect(registerCleanup).toHaveBeenCalled()
    expect(disposeMock).toHaveBeenCalled()
    expect(registerCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      disposeMock.mock.invocationCallOrder[0]!,
    )
  })

  it('skips init when disabled', () => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {})
    render(<Harness enabled={false} />)
    expect(initMock).not.toHaveBeenCalled()
  })

  it('updates options without recreating the chart when deps change', () => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {})
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {})

    const { rerender } = render(<Harness marker={1} />)
    expect(initMock).toHaveBeenCalledTimes(1)
    expect(setOptionMock).toHaveBeenCalledTimes(1)

    rerender(<Harness marker={2} />)

    expect(initMock).toHaveBeenCalledTimes(1)
    expect(disposeMock).not.toHaveBeenCalled()
    expect(setOptionMock).toHaveBeenCalledTimes(2)
    expect(setOptionMock).toHaveBeenLastCalledWith(expect.objectContaining({ series: [{ data: [2] }] }))
  })
})
