import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Input } from '@/components/ui/input'

describe('Input', () => {
  it('forwards ref and onChange', async () => {
    const user = userEvent.setup()
    render(<Input placeholder="p" defaultValue="" />)
    const el = screen.getByPlaceholderText('p')
    await user.type(el, 'hi')
    expect(el).toHaveValue('hi')
  })
})
