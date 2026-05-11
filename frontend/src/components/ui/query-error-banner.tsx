import { Button } from '@/components/ui/button'

export function QueryErrorBanner({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[hsl(var(--severity-critical)/0.35)] bg-[hsl(var(--severity-critical)/0.12)] px-4 py-3 text-sm text-red-50"
      role="alert"
    >
      <span>{message}</span>
      {onRetry != null && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="shrink-0 border-red-400/40">
          Retry
        </Button>
      )}
    </div>
  )
}
