// A confirm step for actions that move money or change the plan. Like ConfirmDelete, it stays
// open until the action has worked, and shows why when it hasn't.
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

export function ConfirmAction({ open, onOpenChange, title, action, destructive, children, onConfirm }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  action: string
  destructive?: boolean
  children: ReactNode
  onConfirm: () => Promise<unknown>
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
        {error && <p role="alert" className="text-sm text-stop">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Not now</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
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
            {busy && <Loader />} {action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
