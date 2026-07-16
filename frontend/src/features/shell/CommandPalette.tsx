import {
  LayoutDashboard,
  LineChart,
  MessageCircle,
  Rows3,
  Table2,
  Terminal,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { api } from '@/api/client'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export function CommandPalette() {
  const navigate = useNavigate()
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const setActive = useUiStore((s) => s.setActiveDatasetId)
  const setPending = useUiStore((s) => s.setPendingQuery)

  const dsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const sqQ = useQuery({ queryKey: ['saved-queries'], queryFn: api.listSavedQueries })
  const chartsQ = useQuery({ queryKey: ['saved-charts'], queryFn: () => api.listSavedCharts() })

  const close = () => setOpen(false)
  const go = (path: string) => {
    navigate(path)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        title="Command palette"
        titleClassName="sr-only"
        showClose
        className="max-w-lg overflow-hidden gap-0 p-0 sm:max-w-xl [&>button]:text-fg-muted"
      >
        <Command
          className={cn(
            'bg-surface-1 text-fg',
            '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-fg-muted',
            '[&_[cmdk-group]]:px-1 [&_[cmdk-group]]:py-2',
            '[&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-border-default',
            '[&_[cmdk-input]]:h-11 [&_[cmdk-input]]:w-full [&_[cmdk-input]]:border-0 [&_[cmdk-input]]:bg-transparent [&_[cmdk-input]]:px-3 [&_[cmdk-input]]:text-sm [&_[cmdk-input]]:outline-none',
            '[&_[cmdk-item]]:flex [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]]:text-sm [&_[cmdk-item]_svg]:h-3.5 [&_[cmdk-item]_svg]:w-3.5',
            '[&_[cmdk-item][data-selected=true]]:bg-white/10',
          )}
        >
          <Command.Input placeholder="Search datasets, navigate, run actions…" autoFocus />
          <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto pb-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">No matches.</Command.Empty>
            <Command.Group heading="Datasets">
              {(dsQ.data ?? []).map((d) => (
                <Command.Item
                  key={d.dataset_id}
                  value={`dataset ${d.name} ${d.dataset_id}`}
                  onSelect={() => {
                    setActive(d.dataset_id)
                    go('/overview')
                  }}
                >
                  <Table2 /> {d.name}{' '}
                  <span className="ml-auto truncate font-mono text-[10px] text-fg-muted">{d.dataset_id}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Navigate">
              <Command.Item value="overview page" onSelect={() => go('/overview')}>
                <LayoutDashboard /> Overview
              </Command.Item>
              <Command.Item value="columns page" onSelect={() => go('/columns')}>
                <Table2 /> Columns
              </Command.Item>
              <Command.Item value="samples page" onSelect={() => go('/samples')}>
                <Rows3 /> Samples
              </Command.Item>
              <Command.Item value="charts page" onSelect={() => go('/charts')}>
                <LineChart /> Charts
              </Command.Item>
              <Command.Item value="ask page" onSelect={() => go('/ask')}>
                <MessageCircle /> Ask
              </Command.Item>
              <Command.Item value="sql page" onSelect={() => go('/sql')}>
                <Terminal /> SQL
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item
                value="open sql editor new tab"
                onSelect={() => {
                  go('/sql')
                }}
              >
                <Terminal /> Open SQL workspace
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Saved SQL">
              {(sqQ.data ?? []).map((q) => (
                <Command.Item
                  key={q.saved_id}
                  value={`saved ${q.name} ${q.sql.slice(0, 80)}`}
                  onSelect={() => {
                    setPending(q.sql)
                    go('/sql')
                  }}
                >
                  <Terminal /> {q.name}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Saved charts">
              {(chartsQ.data ?? []).map((chart) => (
                <Command.Item
                  key={chart.chart_id}
                  value={`saved chart ${chart.name}`}
                  onSelect={() => {
                    setActive(chart.dataset_id)
                    go(`/charts?ds=${encodeURIComponent(chart.dataset_id)}&chart=${encodeURIComponent(chart.chart_id)}`)
                  }}
                >
                  <LineChart /> {chart.name}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
