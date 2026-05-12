import type { DatasetProfile } from '@/api/types'
import { Button } from '@/components/ui/button'

export function SuggestedPrompts({
  profile,
  onPick,
}: {
  profile: DatasetProfile | undefined
  onPick: (text: string) => void
}) {
  if (!profile) return null

  const prompts: string[] = []
  prompts.push(`How many rows are in this dataset?`)
  if (profile.primary_date_column) {
    prompts.push(
      `What is the date range of column ${profile.primary_date_column}?`,
    )
  }
  const cat = profile.column_profiles.find((c) => c.semantic_type === 'categorical')
  if (cat) {
    prompts.push(`What are the top 10 most frequent values in ${cat.name}?`)
  }
  const highNull = [...profile.column_profiles].sort((a, b) => b.null_pct - a.null_pct)[0]
  if (highNull && highNull.null_pct > 5) {
    prompts.push(`Which columns have the highest null percentage?`)
  }
  if (profile.main_numeric_measures.length) {
    const m = profile.main_numeric_measures[0]
    prompts.push(`Show basic summary statistics (min, max, avg) for ${m}.`)
  }

  const uniq = [...new Set(prompts)].slice(0, 6)
  if (uniq.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      <span className="w-full text-[10px] font-medium uppercase tracking-wider text-fg-muted">
        Suggested prompts
      </span>
      {uniq.map((p) => (
        <Button
          key={p}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto max-w-full whitespace-normal py-1.5 text-left text-xs"
          onClick={() => onPick(p)}
        >
          {p}
        </Button>
      ))}
    </div>
  )
}
