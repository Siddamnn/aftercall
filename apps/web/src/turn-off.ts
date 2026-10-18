// Turning a tracker or signal off, when another tracker's condition may depend on it.
import { toast } from './lib/toast'
import type { ApiError } from './api'
import { title } from './signal-draft'

const names = (ns: string[]) => new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(ns.map(title))

/** Turns it off and offers Undo. If conditions depend on it (409), explains and offers "Turn off
 *  anyway": the dependents then just don't run. `done` refreshes the list either way. */
export async function turnOff({ label, off, undo, description, dependents, done }: {
  label: string
  off: (force: boolean) => Promise<void>
  undo: () => Promise<unknown>
  description: string
  /** Trackers whose condition is on this, when the page knows them, for a plain-words warning. */
  dependents: string[]
  done: () => void
}) {
  const finish = () => {
    toast(`${label} is off`, { description, action: { label: 'Undo', onClick: () => void undo().then(done) } })
    done()
  }
  try {
    await off(false)
    finish()
  } catch (e) {
    const err = e as ApiError
    done()
    if (err.status !== 409) return void toast.error(`Couldn't turn off ${label}`, { description: err.message })
    toast.warning(`${dependents.length ? names(dependents) : 'Other trackers'} ${dependents.length === 1 ? 'depends' : 'depend'} on ${label}`, {
      description: dependents.length
        ? `${dependents.length === 1 ? 'It only runs' : 'They only run'} when ${label}'s answer matches. If you turn it off, ${dependents.length === 1 ? 'it won\'t run' : 'they won\'t run'} either.`
        : err.message.replace(/ Pass force=true.*$/, ''),
      duration: 12_000,
      action: { label: 'Turn off anyway', onClick: () => void off(true).then(finish, (x: Error) => toast.error(x.message)) },
    })
  }
}
