import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { DatasetSidebar } from '@/features/datasets/DatasetSidebar'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ColumnsPage } from '@/features/columns/ColumnsPage'
import { QualityPage } from '@/features/quality/QualityPage'
import { SamplesPage } from '@/features/samples/SamplesPage'
import { QueryPage } from '@/features/query/QueryPage'
import { RelationshipsPage } from '@/features/relationships/RelationshipsPage'
import { useUiStore } from '@/store/uiStore'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

const queryClient = new QueryClient()

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <DatasetSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">Data Control Center</div>
          <Link to="/" className="text-xs text-[hsl(var(--muted))] hover:text-white">
            Home
          </Link>
        </header>
        <nav className="flex flex-wrap gap-1 border-b border-white/10 px-4 py-2 text-sm">
          {[
            ['/', 'Overview'],
            ['/columns', 'Columns'],
            ['/quality', 'Quality'],
            ['/samples', 'Samples'],
            ['/sql', 'SQL'],
            ['/relationships', 'Relationships'],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 transition',
                  isActive ? 'bg-white/10 text-white' : 'text-[hsl(var(--muted))] hover:text-white',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function AutoSelectFirstDataset() {
  const q = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const active = useUiStore((s) => s.activeDatasetId)
  const setActive = useUiStore((s) => s.setActiveDatasetId)
  useEffect(() => {
    if (active) return
    const first = q.data?.[0]?.dataset_id
    if (first) setActive(first)
  }, [active, q.data, setActive])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell>
          <AutoSelectFirstDataset />
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/columns" element={<ColumnsPage />} />
            <Route path="/quality" element={<QualityPage />} />
            <Route path="/samples" element={<SamplesPage />} />
            <Route path="/sql" element={<QueryPage />} />
            <Route path="/relationships" element={<RelationshipsPage />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
