import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DistributionCell } from '@/features/columns/ColumnsTableCells'
import { mkColumn } from '@/test/profileFixtures'

describe('DistributionCell', () => {
  it('renders full numeric summary with range, IQR, median, mean, and stdev', () => {
    render(<DistributionCell row={mkColumn()} />)

    expect(screen.getByText('range')).toBeInTheDocument()
    expect(screen.getByText('0 -> 9')).toBeInTheDocument()
    expect(screen.getByText('IQR')).toBeInTheDocument()
    expect(screen.getByText('2 -> 7')).toBeInTheDocument()
    expect(screen.getByText('median')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('mean')).toBeInTheDocument()
    expect(screen.getByText('4.5')).toBeInTheDocument()
    expect(screen.getByText('STDEV')).toBeInTheDocument()
    expect(screen.getByText('2.872')).toBeInTheDocument()
  })

  it('renders partial stats without falling back to dash', () => {
    render(
      <DistributionCell
        row={mkColumn({
          min_value: '1',
          max_value: '5',
          p25_value: null,
          p75_value: null,
          median_value: null,
          mean_value: '0',
          std_value: null,
        })}
      />,
    )

    expect(screen.getByText('range')).toBeInTheDocument()
    expect(screen.getByText('1 -> 5')).toBeInTheDocument()
    expect(screen.getByText('mean')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByText('IQR')).toBeNull()
    expect(screen.queryByText('median')).toBeNull()
    expect(screen.queryByText('STDEV')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('shows a dash when all summary values are missing', () => {
    render(
      <DistributionCell
        row={mkColumn({
          min_value: null,
          max_value: null,
          p25_value: null,
          p75_value: null,
          median_value: null,
          mean_value: null,
          std_value: null,
        })}
      />,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
