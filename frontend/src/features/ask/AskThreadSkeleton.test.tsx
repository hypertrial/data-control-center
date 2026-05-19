import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AskThreadSkeleton } from '@/features/ask/AskThreadSkeleton'

describe('AskThreadSkeleton', () => {
  it('renders loading placeholders', () => {
    render(<AskThreadSkeleton />)
    expect(screen.getByTestId('ask-thread-skeleton')).toBeInTheDocument()
  })
})
