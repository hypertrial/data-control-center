import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  LayoutDashboard,
  Rows3,
  Table2,
  Terminal,
} from 'lucide-react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { api } from '@/api/client'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { DatasetSidebar } from '@/features/datasets/DatasetSidebar'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ColumnsPage } from '@/features/columns/ColumnsPage'
import { QualityPage } from '@/features/quality/QualityPage'
import { SamplesPage } from '@/features/samples/SamplesPage'
import { QueryPage } from '@/features/query/QueryPage'
import { DatasetContextStrip } from '@/features/shell/DatasetContextStrip'
import { UiUrlSync } from '@/hooks/UiUrlSync'
import { cn } from '@/lib/utils'

const queryClient = new QueryClient()

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }> = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/columns', label: 'Columns', icon: Table2 },
  { to: '/quality', label: 'Quality', icon: AlertCircle },
  { to: '/samples', label: 'Samples', icon: Rows3 },
  { to: '/sql', label: 'SQL', icon: Terminal },
]

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <DatasetSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold tracking-tight">Data Control Center</div>
            <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted))]">
              <span className="hidden sm:inline" title="Theme toggle coming soon">
                Theme
              </span>
            </div>
          </div>
        </header>
        <DatasetContextStrip />
        <nav
          className="flex shrink-0 flex-wrap gap-1 border-b border-white/10 px-3 py-2"
          aria-label="Primary"
        >
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition',
                  isActive
                    ? 'bg-white/12 text-white shadow-sm'
                    : 'text-[hsl(var(--muted))] hover:bg-white/5 hover:text-white',
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
        </nav>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function EmptyWorkspaceHero() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <LayoutDashboard className="h-10 w-10 text-[hsl(var(--muted))]" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to Data Control Center</h1>
      <p className="max-w-md text-sm leading-relaxed text-[hsl(var(--muted))]">
        Drop a <span className="font-mono text-white/90">.parquet</span>,{' '}
        <span className="font-mono text-white/90">.csv</span>, or{' '}
        <span className="font-mono text-white/90">.json</span> file in the sidebar (or choose a folder)
        to register a dataset and explore its profile, quality issues, and sample rows.
      </p>
    </div>
  )
}

function RoutedPages() {
  return (
    <Routes>
      <Route path="/" element={<OverviewPage />} />
      <Route path="/columns" element={<ColumnsPage />} />
      <Route path="/quality" element={<QualityPage />} />
      <Route path="/samples" element={<SamplesPage />} />
      <Route path="/sql" element={<QueryPage />} />
    </Routes>
  )
}

function MainBody() {
  const dq = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })

  if (dq.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  if (dq.isError) {
    return (
      <div className="p-6">
        <QueryErrorBanner
          message={(dq.error as Error).message}
          onRetry={() => void dq.refetch()}
        />
      </div>
    )
  }

  if (!dq.data?.length) {
    return <EmptyWorkspaceHero />
  }

  return <RoutedPages />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell>
          <UiUrlSync />
          <MainBody />
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
