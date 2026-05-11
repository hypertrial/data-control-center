import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

describe('Card', () => {
  it('renders slots', () => {
    render(
      <Card data-testid="c">
        <CardHeader>
          <CardTitle>T</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    )
    expect(screen.getByTestId('c')).toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })
})
