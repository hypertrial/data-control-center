import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'

describe('Badge', () => {
  it('covers variants', () => {
    const { rerender } = render(<Badge>default</Badge>)
    expect(screen.getByText('default')).toBeInTheDocument()
    rerender(<Badge variant="critical">c</Badge>)
    rerender(<Badge variant="warning">w</Badge>)
    rerender(<Badge variant="info">i</Badge>)
    expect(screen.getByText('i')).toBeInTheDocument()
  })
})
