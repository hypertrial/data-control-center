import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { filterOperatorsForSemantic, filterValueDisabled, nativeSelectClassName } from '@/features/charts/chartControlOptions'
import { ControlGroup } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import type { ChartFilterOperator } from '@/features/charts/chartUtils'

type Props = Pick<
  ChartWorkspaceState,
  'profile' | 'spec' | 'patchSpec' | 'filterColumns' | 'getColumnSemanticType'
>

export function ChartFilterControls({ profile, spec, patchSpec, filterColumns, getColumnSemanticType }: Props) {
  return (
    <ControlGroup title="Filters">
      <div className="space-y-2">
        {spec.filters.map((filter) => (
          <div key={filter.id} className="grid grid-cols-[1fr_6rem_1fr_auto] gap-1">
            <select
              className={nativeSelectClassName()}
              value={filter.column}
              onChange={(e) =>
                patchSpec({
                  filters: spec.filters.map((item) => {
                    if (item.id !== filter.id) return item
                    const column = e.target.value
                    const operators = filterOperatorsForSemantic(getColumnSemanticType(profile, column))
                    const operator = operators.some((candidate) => candidate.value === item.operator)
                      ? item.operator
                      : operators[0]?.value ?? 'eq'
                    return { ...item, column, operator }
                  }),
                })
              }
            >
              {filterColumns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
            <select
              className={nativeSelectClassName()}
              value={filter.operator}
              onChange={(e) =>
                patchSpec({
                  filters: spec.filters.map((item) =>
                    item.id === filter.id ? { ...item, operator: e.target.value as ChartFilterOperator } : item,
                  ),
                })
              }
            >
              {filterOperatorsForSemantic(getColumnSemanticType(profile, filter.column)).map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </select>
            <Input
              className="h-8"
              value={filter.value}
              disabled={filterValueDisabled(filter.operator)}
              placeholder={filter.operator === 'in' ? 'a, b, c' : 'Value'}
              onChange={(e) =>
                patchSpec({
                  filters: spec.filters.map((item) => (item.id === filter.id ? { ...item, value: e.target.value } : item)),
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Remove filter"
              onClick={() => patchSpec({ filters: spec.filters.filter((item) => item.id !== filter.id) })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1"
          disabled={!filterColumns.length}
          onClick={() =>
            patchSpec({
              filters: [
                ...spec.filters,
                { id: crypto.randomUUID(), column: filterColumns[0] ?? '', operator: 'eq', value: '' },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add filter
        </Button>
      </div>
    </ControlGroup>
  )
}
