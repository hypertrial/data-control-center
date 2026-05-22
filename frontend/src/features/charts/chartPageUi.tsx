import type { ReactNode } from 'react'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-fg-muted">
      <span className="block font-medium text-fg">{label}</span>
      {children}
    </label>
  )
}

export function ControlGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-border-default/80 bg-black/10 p-2">
      <h3 className="text-xs font-semibold text-fg">{title}</h3>
      {children}
    </section>
  )
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-border-default bg-black/20 px-2 text-xs text-fg">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[hsl(var(--accent))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}
