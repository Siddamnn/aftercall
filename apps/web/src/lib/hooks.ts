import { useCallback, useEffect, useRef, useState } from 'react'
import type { UploadStatus } from '../api-types'

/** How often a running upload's status is checked. It is a cheap call (counts only). */
export const STATUS_POLL_MS = 2500

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  // A new function whenever deps change, even when fn is a stable module function
  // (useCallback(fn, deps) would hand back that same function, and nothing would reload).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => fn(), deps)
  const reload = useCallback(() => {
    let live = true
    setState((s) => ({ ...s, loading: true }))
    run().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState((s) => ({ ...s, error: e.message, loading: false })),
    )
    return () => void (live = false)
  }, [run])
  useEffect(reload, [reload])
  return { ...state, reload }
}

/** For panels driven by the URL: keeps the last value while the panel animates out, and
 *  counts openings so each one can remount its content fresh. */
export function useSticky(value: string | undefined) {
  const [s, setS] = useState<{ prev?: string; last?: string; opens: number }>({ opens: 0 })
  if (value !== s.prev) setS({ prev: value, last: value ?? s.last, opens: value ? s.opens + 1 : s.opens })
  return { last: value ?? s.last, opens: s.opens }
}

/** Tells search engines not to index this page (the app, sign-in, invites): robots.txt only
 *  stops crawling, and a linked page can still be indexed without this. */
export function useNoIndex() {
  useEffect(() => {
    const m = document.createElement('meta')
    m.name = 'robots'
    m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])
}

/**
 * Calls `tick` every `everyMs` while `active`, until it returns false. Nothing runs while the tab
 * is hidden; one tick runs as soon as it is visible again. `tick` is kept fresh without restarting the loop.
 */
export function usePolling(tick: () => Promise<boolean>, everyMs: number, active: boolean) {
  const latest = useRef(tick)
  useEffect(() => {
    latest.current = tick
  })
  useEffect(() => {
    if (!active) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      timer = undefined
      if (document.visibilityState !== 'visible') return
      let more = false
      try {
        more = await latest.current()
      } catch {
        more = true // A failed check shouldn't end the polling; try again next time.
      }
      if (live && more) timer = setTimeout(run, everyMs)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && live && timer === undefined) void run()
    }
    document.addEventListener('visibilitychange', onVisible)
    void run()
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, everyMs])
}

/** What changes when calls finish: the full results only need reloading when this does. */
export const progressKey = (u: UploadStatus) => `${u.counts.done}/${u.counts.failed}/${u.counts.over_limit}`
