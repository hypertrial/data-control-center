import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Kbd, ModKey } from '@/components/ui/kbd'

describe('Kbd', () => {
  it('renders keyboard labels and platform modifier', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mac' })
    render(
      <>
        <Kbd>Enter</Kbd>
        <ModKey />
      </>,
    )

    expect(screen.getByText('Enter')).toBeInTheDocument()
    expect(screen.getByText('⌘')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
