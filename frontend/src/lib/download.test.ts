import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadDataUrl, downloadText, safeDownloadName } from '@/lib/download'

describe('download helpers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sanitizes filenames', () => {
    expect(safeDownloadName('Sales 2026.csv', 'Revenue / Region')).toBe('sales-2026.csv-revenue-region')
    expect(safeDownloadName()).toBe('data-control-center')
  })

  it('downloads blobs and data URLs with native anchors', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.useFakeTimers()

    downloadText('a,b\n1,2', 'data.csv', 'text/csv')
    downloadDataUrl('data:image/png;base64,test', 'chart.png')
    vi.runAllTimers()

    expect(create).toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(2)
    expect(revoke).toHaveBeenCalledWith('blob:test')
    expect(revoke).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('rejects malformed image data URLs', () => {
    expect(() => downloadDataUrl('https://example.test/chart.png', 'chart.png')).toThrow(
      'Invalid chart image',
    )
  })
})
