import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeft,
  RefreshCw,
  Rows3,
  Search,
  Table2,
  Terminal,
  XCircle,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { formatBytes, formatCount, formatDatasetFormat, formatRelativeTime } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/columns', label: 'Columns', icon: Table2 },
  { to: '/quality', label: 'Quality', icon: AlertCircle },
  { to: '/samples', label: 'Samples', icon: Rows3 },
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/sql', label: 'SQL', icon: Terminal },
]

function QualityMicroBar({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-xs text-fg-muted">-</span>
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  const color =
    sev === 'critical'
      ? 'bg-[hsl(var(--severity-critical))]'
      : sev === 'warning'
        ? 'bg-[hsl(var(--severity-warning))]'
        : 'bg-[hsl(var(--severity-ok))]'
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums text-sm font-semibold text-fg">{score}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function TopBar() {
  const location = useLocation()
  const activeId = useUiStore((s) => s.activeDatasetId)
  const setPalette = useUiStore((s) => s.setCommandPaletteOpen)
  const setShortcuts = useUiStore((s) => s.setShortcutSheetOpen)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed)
  const setMobileOpen = useUiStore((s) => s.setSidebarMobileOpen)

  const dsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const profileQ = useDatasetProfile(activeId)

  const summary = (dsQ.data ?? []).find((d) => d.dataset_id === activeId)
  const name = summary?.name ?? profileQ.data?.name ?? activeId
  const rows = profileQ.data?.rows ?? summary?.row_count ?? null
  const cols = profileQ.data?.columns ?? summary?.column_count ?? null
  const sizeBytes = profileQ.data?.file_size_bytes ?? summary?.file_size_bytes ?? null
  const format = summary?.format ?? '-'
  const qScore = profileQ.data?.quality_score ?? summary?.quality_score ?? null
  const updated = profileQ.dataUpdatedAt

  const runningRefresh = profileQ.runningRefresh

  const onRefresh = profileQ.refresh
  const onCancelRefresh = profileQ.cancelRefresh

  return (
    <header className="shrink-0 border-b border-border-default bg-[hsl(var(--card))]/60 backdrop-blur-md">
      <div className="flex items-start gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex shrink-0 items-center gap-1 pt-0.5 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            aria-label="Open datasets sidebar"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden shrink-0 lg:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-fg-muted sm:text-xs">
            Data Control Center
          </div>
          {activeId ? (
            <>
              <h1 className="truncate text-sm font-semibold leading-tight text-fg sm:text-base" title={name ?? ''}>
                {name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-muted sm:text-xs">
                <span className="tabular-nums whitespace-nowrap">{formatCount(rows)} rows</span>
                <span aria-hidden className="text-white/25">
                  ·
                </span>
                <span className="tabular-nums whitespace-nowrap">{formatCount(cols)} cols</span>
                <span aria-hidden className="text-white/25">
                  ·
                </span>
                <span className="tabular-nums whitespace-nowrap">{formatBytes(sizeBytes)}</span>
                <Badge variant="default" className="shrink-0 font-normal">
                  {formatDatasetFormat(format)}
                </Badge>
                {updated ? (
                  <>
                    <span aria-hidden className="hidden text-white/25 sm:inline">
                      ·
                    </span>
                    <span className="hidden whitespace-nowrap sm:inline">{formatRelativeTime(updated)}</span>
                  </>
                ) : null}
                <span className="flex w-full basis-full items-center gap-2 pt-0.5 sm:w-auto sm:basis-auto sm:pt-0 md:hidden">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Quality</span>
                  <QualityMicroBar score={qScore} />
                </span>
                <span className="hidden items-center gap-2 md:flex">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Quality</span>
                  <QualityMicroBar score={qScore} />
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-muted">Select a dataset from the sidebar to begin.</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5 sm:flex-row sm:items-center">
          <Tooltip content="Command palette (Cmd+K)">
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setPalette(true)}>
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="ml-1 hidden rounded border border-border-default px-1 font-mono text-[10px] text-fg-muted sm:inline">
                Cmd+K
              </kbd>
            </Button>
          </Tooltip>
          <Tooltip content="Shortcuts (?)">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Keyboard shortcuts"
              onClick={() => setShortcuts(true)}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <nav
        className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-border-default/80 px-2 py-1.5 sm:px-3"
        aria-label="Primary"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={{ pathname: to, search: location.search }}
            end={end}
            className={({ isActive }) =>
              cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition sm:text-sm',
                isActive ? 'bg-white/12 text-white shadow-sm' : 'text-fg-muted hover:bg-white/5 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="h-3.5 w-3.5 opacity-80" aria-hidden />
                <span className={cn(isActive && 'font-medium')}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
        <div className="flex w-full min-w-[12rem] flex-1 flex-wrap items-center justify-end gap-2 sm:w-auto">
          {runningRefresh ? (
            <Badge variant="default" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Profile refresh running
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={!activeId || profileQ.isPendingProfile || runningRefresh}
            onClick={() => onRefresh()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh profile</span>
            <span className="sm:hidden">Refresh</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={!runningRefresh}
            onClick={() => onCancelRefresh()}
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      </nav>
    </header>
  )
}
