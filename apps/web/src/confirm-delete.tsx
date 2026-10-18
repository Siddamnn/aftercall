// Deleting can't be undone (turning off can), so it always asks first.
import { Trash } from '@phosphor-icons/react'
import { Loader } from './loaders'
import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog'
import { Button } from './components/ui/button'

export function ConfirmDelete({ open, onOpenChange, title, children, onConfirm, blocked }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children: ReactNode
  onConfirm: () => Promise<void>
  /** Why it can't be deleted yet (e.g. a condition depends on it). Disables Delete. */
  blocked?: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && (setError(undefined), onOpenChange(o))}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-semibold tracking-tight">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-ink-2">{children}</AlertDialogDescription>
        </AlertDialogHeader>
        {blocked && <p role="alert" className="rounded-lg border border-warn/25 bg-warn-soft px-3 py-2.5 text-sm text-foreground">{blocked}</p>}
        {error && <p role="alert" className="text-sm text-stop">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          {/* Not AlertDialogAction: that closes at once, before the delete has worked. */}
          <Button
            variant="destructive"
            disabled={busy || !!blocked}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await onConfirm()
                onOpenChange(false)
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader /> : <Trash aria-hidden />} Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
