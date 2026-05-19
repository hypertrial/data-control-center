import { CardSkeleton } from '@/components/ui/skeleton'

export function AskThreadSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-2" data-testid="ask-thread-skeleton">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
