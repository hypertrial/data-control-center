import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Label } from '@/components/ui/label'

describe('Label', () => {
  it('renders label text', () => {
    render(<Label>Field label</Label>)
    expect(screen.getByText('Field label')).toBeInTheDocument()
  })
})
