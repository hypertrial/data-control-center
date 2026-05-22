import { cn } from '@/lib/utils'
import type { ChartAggregation, ChartBucket, ChartFilterOperator, ChartYAxisScale } from '@/features/charts/chartUtils'

export const BAR_AGGREGATIONS: Array<{ value: ChartAggregation; label: string }> = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'median', label: 'Median' },
  { value: 'stddev', label: 'Std dev' },
  { value: 'p25', label: 'p25' },
  { value: 'p75', label: 'p75' },
  { value: 'count_distinct', label: 'Count distinct' },
]

export const AGGREGATIONS: Array<{ value: ChartAggregation; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'avg', label: 'Average' },
  { value: 'sum', label: 'Sum' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'median', label: 'Median' },
  { value: 'stddev', label: 'Std dev' },
  { value: 'p25', label: 'p25' },
  { value: 'p75', label: 'p75' },
  { value: 'count', label: 'Count' },
  { value: 'count_distinct', label: 'Count distinct' },
]

export const BUCKETS: Array<{ value: ChartBucket; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

const FILTER_OPERATORS: Array<{ value: ChartFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'in', label: 'in' },
  { value: 'is_null', label: 'is null' },
  { value: 'is_not_null', label: 'is not null' },
]

export const Y_SCALE_OPTIONS: Array<{ value: ChartYAxisScale; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'zero', label: 'Start at zero' },
  { value: 'manual', label: 'Manual' },
]

export function filterOperatorsForSemantic(semantic: string): Array<{ value: ChartFilterOperator; label: string }> {
  const nullChecks = FILTER_OPERATORS.filter((operator) => operator.value === 'is_null' || operator.value === 'is_not_null')
  if (semantic === 'numeric' || semantic === 'datetime') {
    return FILTER_OPERATORS.filter((operator) =>
      ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null', 'is_not_null'].includes(operator.value),
    )
  }
  if (semantic === 'text') {
    return FILTER_OPERATORS.filter((operator) =>
      ['eq', 'neq', 'contains', 'starts_with', 'in', 'is_null', 'is_not_null'].includes(operator.value),
    )
  }
  if (['categorical', 'boolean_like', 'id_like'].includes(semantic)) {
    return FILTER_OPERATORS.filter((operator) =>
      ['eq', 'neq', 'in', 'is_null', 'is_not_null'].includes(operator.value),
    )
  }
  return [...FILTER_OPERATORS, ...nullChecks].filter(
    (operator, index, all) => all.findIndex((item) => item.value === operator.value) === index,
  )
}

export function filterValueDisabled(operator: ChartFilterOperator): boolean {
  return operator === 'is_null' || operator === 'is_not_null'
}

export function nativeSelectClassName(disabled?: boolean): string {
  return cn(
    'h-8 w-full rounded-md border border-border-default bg-black/30 px-2 text-sm text-fg outline-none',
    'focus:border-border-accent focus:ring-2 focus:ring-[hsl(var(--accent)_/_0.18)]',
    disabled && 'cursor-not-allowed opacity-50',
  )
}
