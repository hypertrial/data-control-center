import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useUiStore } from '@/store/uiStore'

const sevVariant = (s: string) => {
  if (s === 'critical') return 'critical' as const
  if (s === 'warning') return 'warning' as const
  return 'info' as const
}

export function QualityPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const sev = useUiStore((s) => s.qualitySeverityFilter)
  const setSev = useUiStore((s) => s.setQualitySeverityFilter)

  const q = useQuery({
    queryKey: ['quality', activeId],
    queryFn: () => api.getQuality(activeId!),
    enabled: !!activeId,
  })

  if (!activeId)
    return <div className="p-6 text-[hsl(var(--muted))]">Select a dataset.</div>
  if (q.isLoading) return <div className="p-6">Loading issues…</div>
  if (q.isError) return <div className="p-6 text-red-300">{(q.error as Error).message}</div>

  let issues = q.data ?? []
  if (sev !== 'all') {
    issues = issues.filter((i) => i.severity === sev)
  }

  const grouped = {
    critical: issues.filter((i) => i.severity === 'critical'),
    warning: issues.filter((i) => i.severity === 'warning'),
    info: issues.filter((i) => i.severity === 'info'),
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[hsl(var(--muted))]">Filter</span>
        <select
          className="h-9 rounded-md border border-white/15 bg-black/30 px-2 text-sm"
          value={sev}
          onChange={(e) => setSev(e.target.value)}
        >
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {(['critical', 'warning', 'info'] as const).map((k) => (
        <section key={k} className="space-y-2">
          <h2 className="text-sm font-semibold capitalize">{k}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {grouped[k].length === 0 && (
              <div className="text-xs text-[hsl(var(--muted))]">No {k} issues.</div>
            )}
            {grouped[k].map((issue) => (
              <Card key={issue.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <CardTitle className="text-sm">{issue.title}</CardTitle>
                  <Badge variant={sevVariant(issue.severity)}>{issue.severity}</Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-[hsl(var(--foreground))]/90">
                  <p>{issue.description}</p>
                  <p className="text-[hsl(var(--muted))]">{issue.why_it_matters}</p>
                  {issue.affected_columns.length > 0 && (
                    <p>
                      <span className="text-[hsl(var(--muted))]">Columns: </span>
                      {issue.affected_columns.join(', ')}
                    </p>
                  )}
                  {issue.examples.length > 0 && (
                    <pre className="overflow-auto rounded-md bg-black/30 p-2 text-[10px]">
                      {JSON.stringify(issue.examples, null, 2)}
                    </pre>
                  )}
                  {issue.suggested_sql && (
                    <pre className="overflow-auto rounded-md bg-black/40 p-2 text-[10px] text-green-200">
                      {issue.suggested_sql}
                    </pre>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
