import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast border-border-default bg-surface-elevated text-fg shadow-lg',
          description: 'text-fg-muted',
          actionButton: 'bg-accent text-fg-inverse',
          cancelButton: 'bg-surface-2 text-fg-muted',
        },
      }}
    />
  )
}
