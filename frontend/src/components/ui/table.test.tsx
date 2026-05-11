import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

describe('Table', () => {
  it('renders table structure', () => {
    render(
      <Table>
        <THead>
          <TR>
            <TH>h</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>d</TD>
          </TR>
        </TBody>
      </Table>,
    )
    expect(screen.getByText('h')).toBeInTheDocument()
    expect(screen.getByText('d')).toBeInTheDocument()
  })
})
