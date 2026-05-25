import { Suspense, lazy, type ReactNode } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { LayoutDashboard } from 'lucide-react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { api } from '@/api/client'
import { appQueryClient } from '@/appQueryClient'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DatasetSidebar } from '@/features/datasets/DatasetSidebar'
import { DatasetDropzone } from '@/features/datasets/DatasetDropzone'
import {
  DatasetIngestionProvider,
  useDatasetIngestionContext,
} from '@/features/datasets/DatasetIngestionProvider'

const ColumnsPage = lazy(() =>
  import('@/features/columns/ColumnsPage').then((m) => ({ default: m.ColumnsPage })),
)
const SamplesPage = lazy(() =>
  import('@/features/samples/SamplesPage').then((m) => ({ default: m.SamplesPage })),
)
const ChartsPage = lazy(() =>
  import('@/features/charts/ChartsPage').then((m) => ({ default: m.ChartsPage })),
)
const AskPage = lazy(() => import('@/features/ask/AskPage').then((m) => ({ default: m.AskPage })))
const QueryPage = lazy(() =>
  import('@/features/query/QueryPage').then((m) => ({ default: m.QueryPage })),
)
import { CommandPalette } from '@/features/shell/CommandPalette'
import { ShortcutCheatsheet } from '@/features/shell/ShortcutCheatsheet'
import { MainScrollRegion } from '@/features/shell/MainScrollRegion'
import { RoutePageTransition } from '@/features/shell/RoutePageTransition'
import { TopBar } from '@/features/shell/TopBar'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { UiUrlSync } from '@/hooks/UiUrlSync'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <DatasetSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MainScrollRegion>{children}</MainScrollRegion>
      </div>
    </div>
  )
}

function ShortcutListener() {
  useGlobalShortcuts()
  return null
}

function EmptyWorkspaceHero() {
  const { busy, ingestFiles } = useDatasetIngestionContext()

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <LayoutDashboard className="h-10 w-10 text-fg-muted" aria-hidden />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome to Data Control Center</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-fg-muted">
          Drop CSV, Parquet, or JSON files below, or use Import DuckDB in the sidebar for database files. Press{' '}
          <kbd className="rounded border border-border-default px-1 font-mono text-xs">⌘K</kbd> anytime to search datasets and jump between views.
        </p>
      </div>
      <div className="w-full max-w-md">
        <DatasetDropzone busy={busy} onFilesPicked={(files) => void ingestFiles(files)} />
      </div>
    </div>
  )
}

function RouteLoadingFallback() {
  return (
    <div className="space-y-3 p-6">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}

function RoutedPages() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/columns" replace />} />
        <Route path="/columns" element={<ColumnsPage />} />
        <Route path="/quality" element={<Navigate to="/columns" replace />} />
        <Route path="/samples" element={<SamplesPage />} />
        <Route path="/charts" element={<ChartsPage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/sql" element={<QueryPage />} />
      </Routes>
    </Suspense>
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

  return (
    <RoutePageTransition>
      <RoutedPages />
    </RoutePageTransition>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <TooltipProvider delayDuration={280}>
        <Toaster />
        <BrowserRouter>
          <DatasetIngestionProvider>
            <ShortcutListener />
            <Shell>
              <UiUrlSync />
              <CommandPalette />
              <ShortcutCheatsheet />
              <MainBody />
            </Shell>
          </DatasetIngestionProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
