import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

describe('Tabs', () => {
  it('switches panels', async () => {
    const user = userEvent.setup()
    function Shell() {
      const [v, setV] = React.useState('a')
      return (
        <Tabs value={v} onValueChange={setV}>
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">panel-a</TabsContent>
          <TabsContent value="b">panel-b</TabsContent>
        </Tabs>
      )
    }
    render(<Shell />)
    expect(screen.getByText('panel-a')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(screen.getByText('panel-b')).toBeInTheDocument()
  })
})
