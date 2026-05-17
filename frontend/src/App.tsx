import type { ReactNode } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { LayoutDashboard } from 'lucide-react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { api } from '@/api/client'
import { appQueryClient } from '@/appQueryClient'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DatasetSidebar } from '@/features/datasets/DatasetSidebar'
import { DatasetDropzone } from '@/features/datasets/DatasetDropzone'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { AskPage } from '@/features/ask/AskPage'
import { ColumnsPage } from '@/features/columns/ColumnsPage'
import { QualityPage } from '@/features/quality/QualityPage'
import { SamplesPage } from '@/features/samples/SamplesPage'
import { QueryPage } from '@/features/query/QueryPage'
import { CommandPalette } from '@/features/shell/CommandPalette'
import { ShortcutCheatsheet } from '@/features/shell/ShortcutCheatsheet'
import { TopBar } from '@/features/shell/TopBar'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { UiUrlSync } from '@/hooks/UiUrlSync'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <DatasetSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function ShortcutListener() {
  useGlobalShortcuts()
  return null
}

function EmptyWorkspaceHero() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <LayoutDashboard className="h-10 w-10 text-fg-muted" aria-hidden />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome to Data Control Center</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-fg-muted">
          Drop a dataset below or choose a folder. Press <kbd className="rounded border border-border-default px-1 font-mono text-xs">⌘K</kbd> anytime to search datasets and jump between views.
        </p>
      </div>
      <div className="w-full max-w-md">
        <DatasetDropzone />
      </div>
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
      <Route path="/ask" element={<AskPage />} />
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
    <QueryClientProvider client={appQueryClient}>
      <TooltipProvider delayDuration={280}>
        <Toaster />
        <BrowserRouter>
          <ShortcutListener />
          <Shell>
            <UiUrlSync />
            <CommandPalette />
            <ShortcutCheatsheet />
            <MainBody />
          </Shell>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
