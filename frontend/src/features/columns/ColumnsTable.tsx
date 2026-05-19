import { flexRender, type Table as TableInstance } from '@tanstack/react-table'
import type { ColumnProfile } from '@/api/types'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type ColumnsTableProps = {
  activeId: string
  table: TableInstance<ColumnProfile>
  setSelectedColumn: (name: string) => void
  setDrawerOpen: (open: boolean) => void
}

export function ColumnsTable({
  activeId,
  table,
  setSelectedColumn,
  setDrawerOpen,
}: ColumnsTableProps) {
  return (
    <Table className="min-w-[1280px]">
      <caption className="sr-only">Columns for dataset {activeId}</caption>
      <THead className="sticky top-0 z-10 bg-[hsl(var(--background))]/95 backdrop-blur">
        {table.getHeaderGroups().map((hg) => (
          <TR key={hg.id}>
            {hg.headers.map((h) => {
              const sorted = h.column.getIsSorted()
              const isName = h.column.id === 'name'
              return (
                <TH
                  key={h.id}
                  scope="col"
                  className={cn(
                    isName &&
                      'sticky left-0 z-30 w-[min(28rem,40vw)] min-w-[12rem] max-w-[min(28rem,40vw)] border-r border-border-default bg-[hsl(var(--background))]/95 backdrop-blur',
                  )}
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                  }
                >
                  {h.isPlaceholder ? null : h.column.getCanSort() ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 font-medium"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{
                        asc: '↑',
                        desc: '↓',
                      }[h.column.getIsSorted() as string] ?? null}
                    </button>
                  ) : (
                    <span className="font-medium">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </span>
                  )}
                </TH>
              )
            })}
          </TR>
        ))}
      </THead>
      <TBody>
        {table.getRowModel().rows.map((row) => (
          <TR
            key={row.id}
            className="group cursor-pointer"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const name = row.original.name
                setSelectedColumn(name)
                setDrawerOpen(true)
              }
            }}
            onClick={() => {
              const name = row.original.name
              setSelectedColumn(name)
              setDrawerOpen(true)
            }}
          >
            {row.getVisibleCells().map((cell) => (
              <TD
                key={cell.id}
                className={cn(
                  cell.column.id === 'name' &&
                    'sticky left-0 z-20 w-[min(28rem,40vw)] min-w-[12rem] max-w-[min(28rem,40vw)] border-r border-border-default bg-[hsl(var(--background))]/95 backdrop-blur group-hover:bg-white/[0.04]',
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
