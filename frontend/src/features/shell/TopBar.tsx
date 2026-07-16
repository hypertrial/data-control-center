import type { LucideIcon } from 'lucide-react'
import {
  HelpCircle,
  LayoutDashboard,
  LineChart,
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
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/columns', label: 'Columns', icon: Table2, end: true },
  { to: '/samples', label: 'Samples', icon: Rows3 },
  { to: '/charts', label: 'Charts', icon: LineChart },
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/sql', label: 'SQL', icon: Terminal },
]

function QualityBar({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return (
      <div
        className="inline-flex items-center gap-2 px-1.5 py-0.5 text-xs text-fg-muted"
        data-testid="quality-bar"
        aria-label="Quality score unavailable"
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Quality</span>
        <span>-</span>
      </div>
    )
  }
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  const color =
    sev === 'critical'
      ? 'bg-[hsl(var(--severity-critical))]'
      : sev === 'warning'
        ? 'bg-[hsl(var(--severity-warning))]'
        : 'bg-[hsl(var(--severity-ok))]'
  return (
    <div
      className="inline-flex items-center gap-2 px-1.5 py-0.5"
      aria-label={`Quality score ${score}`}
      data-testid="quality-bar"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Quality</span>
      <span className="tabular-nums text-sm font-semibold text-fg">{score}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function HeaderIdentity({
  name,
  rows,
  cols,
  sizeBytes,
  format,
  updated,
  qScore,
  profilingLabel,
}: {
  name: string | null | undefined
  rows: number | null
  cols: number | null
  sizeBytes: number | null
  format: string
  updated: number | undefined
  qScore: number | null | undefined
  profilingLabel?: string | null
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <h1 className="min-w-0 truncate text-sm font-semibold leading-tight text-fg sm:text-base" title={name ?? ''}>
        {name}
      </h1>
      <Badge variant="default" className="shrink-0 font-normal">
        {formatDatasetFormat(format)}
      </Badge>
      <span aria-hidden className="hidden text-white/25 sm:inline">
        ·
      </span>
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
        {profilingLabel ? (
          <>
            <span aria-hidden className="text-white/25">
              ·
            </span>
            <span className="whitespace-nowrap text-[hsl(var(--fg-muted))]">{profilingLabel}</span>
          </>
        ) : null}
        {updated ? (
          <>
            <span aria-hidden className="hidden text-white/25 sm:inline">
              ·
            </span>
            <span className="hidden whitespace-nowrap sm:inline">{formatRelativeTime(updated)}</span>
          </>
        ) : null}
      </div>
      <span aria-hidden className="hidden text-white/25 md:inline">
        ·
      </span>
      <QualityBar score={qScore} />
    </div>
  )
}

function HeaderActions({
  runningRefresh,
  refreshDisabled,
  onSearch,
  onHelp,
  onRefreshOrCancel,
}: {
  runningRefresh: boolean
  refreshDisabled: boolean
  onSearch: () => void
  onHelp: () => void
  onRefreshOrCancel: () => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 self-start pt-0.5 sm:gap-2">
      <Tooltip content="Command palette (Cmd+K)">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onSearch}>
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-1 hidden rounded border border-border-default px-1 font-mono text-[10px] text-fg-muted sm:inline">
            Cmd+K
          </kbd>
        </Button>
      </Tooltip>
      <Button
        type="button"
        variant={runningRefresh ? 'default' : 'outline'}
        size="sm"
        className="gap-1"
        disabled={refreshDisabled && !runningRefresh}
        aria-label={runningRefresh ? 'Cancel refresh' : 'Refresh profile'}
        onClick={onRefreshOrCancel}
      >
        {runningRefresh ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <XCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Cancel refresh</span>
            <span className="sm:hidden">Cancel</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh profile</span>
            <span className="sm:hidden">Refresh</span>
          </>
        )}
      </Button>
      <Tooltip content="Shortcuts (?)">
        <Button type="button" variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={onHelp}>
          <HelpCircle className="h-4 w-4" />
        </Button>
      </Tooltip>
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
  const profilingLabel =
    profileQ.isPendingProfile && !profileQ.data
      ? profileQ.jobProgress != null && profileQ.jobProgress > 0
        ? `Profiling… ${Math.round(profileQ.jobProgress * 100)}%`
        : 'Profiling…'
      : null

  const onRefresh = profileQ.refresh
  const onCancelRefresh = profileQ.cancelRefresh
  const navSearch = (path: string) => {
    const next = new URLSearchParams(location.search)
    if (path !== '/charts') next.delete('chart')
    const value = next.toString()
    return value ? `?${value}` : ''
  }

  return (
    <header className="shrink-0 border-b border-border-default bg-[hsl(var(--surface-1))]/60 backdrop-blur-md">
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

        {activeId ? (
          <HeaderIdentity
            name={name}
            rows={rows}
            cols={cols}
            sizeBytes={sizeBytes}
            format={format}
            updated={updated}
            qScore={qScore}
            profilingLabel={profilingLabel}
          />
        ) : (
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-fg-muted sm:text-xs">
              Data Control Center
            </div>
            <p className="text-xs text-fg-muted">Select a dataset from the sidebar to begin.</p>
          </div>
        )}

        <HeaderActions
          runningRefresh={runningRefresh}
          refreshDisabled={!activeId || profileQ.isPendingProfile}
          onSearch={() => setPalette(true)}
          onHelp={() => setShortcuts(true)}
          onRefreshOrCancel={() => (runningRefresh ? onCancelRefresh() : onRefresh())}
        />
      </div>

      <nav
        className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-border-default/80 px-2 py-1.5 sm:px-3"
        aria-label="Primary"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={{ pathname: to, search: navSearch(to) }}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs',
                'transition-[color,background-color,box-shadow,transform] duration-150 ease-out',
                'motion-reduce:transition-none',
                isActive
                  ? 'bg-white/12 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-fg-muted hover:bg-white/5 hover:text-fg active:scale-[0.98]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('h-3.5 w-3.5 transition-opacity duration-150', isActive ? 'opacity-100' : 'opacity-70')}
                  aria-hidden
                />
                <span className={cn(isActive && 'font-medium')}>{label}</span>
                {isActive ? (
                  <span
                    className="pointer-events-none absolute inset-x-2 -bottom-px h-px rounded-full bg-[hsl(var(--accent))]/80 motion-reduce:hidden"
                    aria-hidden
                  />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
