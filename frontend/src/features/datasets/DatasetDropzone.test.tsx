import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DatasetDropzone } from '@/features/datasets/DatasetDropzone'

const toastMock = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))

describe('DatasetDropzone', () => {
  it('forwards tabular files to ingestion handler', async () => {
    const user = userEvent.setup()
    const onFilesPicked = vi.fn()
    const { container } = render(<DatasetDropzone onFilesPicked={onFilesPicked} />)
    const input = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement
    await user.upload(input, new File(['a'], 'a.csv'))
    expect(onFilesPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.csv' })])
  })

  it('forwards dropped files', () => {
    const onFilesPicked = vi.fn()
    render(<DatasetDropzone onFilesPicked={onFilesPicked} />)
    const zone = screen.getByRole('button', { name: /Drop files here/ })
    const file = new File(['a'], 'a.csv', { type: 'text/csv' })
    const dt = new DataTransfer()
    dt.items.add(file)
    fireEvent.dragEnter(zone)
    fireEvent.dragOver(zone)
    fireEvent.drop(zone, { dataTransfer: dt })
    expect(onFilesPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.csv' })])
  })

  it('toasts when drop has no files', () => {
    toastMock.error.mockClear()
    render(<DatasetDropzone onFilesPicked={vi.fn()} />)
    const zone = screen.getByRole('button', { name: /Drop files here/ })
    fireEvent.drop(zone, { dataTransfer: new DataTransfer() })
    expect(toastMock.error).toHaveBeenCalled()
  })

  it('forwards folder picks when onFolderPicked is set', async () => {
    const user = userEvent.setup()
    const onFolderPicked = vi.fn()
    const { container } = render(
      <DatasetDropzone onFilesPicked={vi.fn()} onFolderPicked={onFolderPicked} />,
    )
    const folderInput = container.querySelector('input[webkitdirectory]') as HTMLInputElement
    await user.upload(folderInput, new File(['a'], 'a.csv'))
    expect(onFolderPicked).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.csv' })])
  })

  it('shows busy state', () => {
    render(<DatasetDropzone busy onFilesPicked={vi.fn()} />)
    expect(screen.getByText('Uploading…')).toBeInTheDocument()
  })

  it('clears drag highlight when pointer leaves the drop zone', () => {
    render(<DatasetDropzone onFilesPicked={vi.fn()} />)
    const zone = screen.getByRole('button', { name: /Drop files here/ })
    fireEvent.dragEnter(zone)
    fireEvent.dragLeave(zone, { relatedTarget: document.body })
    expect(zone.className).not.toContain('border-[hsl(var(--accent))]')
  })

  it('shows busy spinner on folder button', () => {
    render(<DatasetDropzone busy onFilesPicked={vi.fn()} onFolderPicked={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDisabled()
  })
})
