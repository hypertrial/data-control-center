import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetDropzone } from '@/features/datasets/DatasetDropzone'

function wrap(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('DatasetDropzone', () => {
  it('uploads selected supported files', async () => {
    const user = userEvent.setup()
    const onFilesPicked = vi.fn()
    const { container } = wrap(<DatasetDropzone onFilesPicked={onFilesPicked} />)
    const input = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement

    await user.upload(input, new File(['id\n1'], 'x.csv', { type: 'text/csv' }))

    await waitFor(() => expect(onFilesPicked).toHaveBeenCalled())
    expect(onFilesPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'x.csv' })])
  })

  it('forwards folder picks to onFolderPicked when provided', async () => {
    const onFilesPicked = vi.fn()
    const onFolderPicked = vi.fn()
    const { container } = wrap(
      <DatasetDropzone onFilesPicked={onFilesPicked} onFolderPicked={onFolderPicked} />,
    )
    const folderInput = container.querySelector(
      'input[aria-label="Upload folder of data files"]',
    ) as HTMLInputElement
    Object.defineProperty(folderInput, 'files', {
      value: [new File(['a'], 'nested.csv')],
      configurable: true,
    })
    fireEvent.change(folderInput)
    expect(onFolderPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'nested.csv' })])
    expect(onFilesPicked).not.toHaveBeenCalled()
  })

  it('forwards duckdb files to ingestion handler', async () => {
    const user = userEvent.setup()
    const onFilesPicked = vi.fn()
    const { container } = wrap(<DatasetDropzone onFilesPicked={onFilesPicked} />)
    const input = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement
    await user.upload(input, new File(['db'], 'source.duckdb'))
    expect(onFilesPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'source.duckdb' })])
  })

  it('handles drops, drag leave, and unsupported files', async () => {
    const onFilesPicked = vi.fn()
    const { container } = wrap(<DatasetDropzone onFilesPicked={onFilesPicked} />)
    const zone = screen.getByRole('button', { name: /Drop files here/i })
    const file = new File(['id\n1'], 'x.csv', { type: 'text/csv' })
    const dt = new DataTransfer()
    dt.items.add(file)

    fireEvent.dragEnter(zone)
    expect(zone.className).toContain('border-[hsl(var(--accent))]')
    fireEvent.dragLeave(zone, { relatedTarget: document.body })
    fireEvent.drop(zone, { dataTransfer: dt })
    await waitFor(() => expect(onFilesPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'x.csv' })]))

    const input = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'bad.exe')], configurable: true })
    fireEvent.change(input)
    expect(onFilesPicked).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'bad.exe' })])
  })
})
