// The conversations behind a mark (B11), in a side panel; each opens the call panel.
import { ChatsCircle, EnvelopeSimple, Headset, Robot, Warning } from '@phosphor-icons/react'
import { useState } from 'react'
import { listCalls, type CallResult, type InsightScope, type Tracker } from './api'
import { Button } from './components/ui/button'
import { channelLabel, num, pct, plural } from './lib/format'
import { useLoad } from './lib/hooks'
import { cn } from './lib/utils'
import { CallPanel } from './pages/Results'
import { ErrorNote, Mono, SidePanel } from './ui'

const CHANNEL_ICON: Record<string, typeof Headset> = { call: Headset, voice_agent: Robot, chat: ChatsCircle, email: EnvelopeSimple }

/** What to open: a label, the full scope of the conversations, and the signal whose confidence to show. */
export interface Drill { label: string; scope: InsightScope; signal?: string }

export function DrillDown({ drill, trackers, onClose }: { drill?: Drill; trackers: Tracker[]; onClose: () => void }) {
  const [pages, setPages] = useState<{ key: string; calls: CallResult[]; next: string | null; total: number }>()
  const [open, setOpen] = useState<number>()
  const [loadingMore, setLoadingMore] = useState(false)
  const q = drill?.scope
  const key = q ? JSON.stringify(q) : ''
  const first = useLoad(() => (q ? listCalls(q, { limit: 50 }) : Promise.resolve(undefined)), [key])
  if (key && first.data && pages?.key !== key) setPages({ key, calls: first.data.calls, next: first.data.next_cursor, total: first.data.total })
  const ready = !!key && pages?.key === key
  const calls = ready ? pages!.calls : []
  const [tr, sig] = drill?.signal?.split('.') ?? []

  const more = async () => {
    if (!q || !pages?.next) return
    setLoadingMore(true)
    const page = await listCalls(q, { limit: 50, cursor: pages.next })
    setPages({ ...pages, calls: [...pages.calls, ...page.calls], next: page.next_cursor })
    setLoadingMore(false)
  }

  return (
    <>
      <SidePanel
        open={!!drill && open === undefined}
        onClose={onClose}
        title={drill?.label ?? 'Conversations'}
        subtitle={ready ? plural(pages!.total, 'conversation') : 'Loading…'}
      >
        {first.error ? <ErrorNote onRetry={first.reload}>{first.error}</ErrorNote> : !calls.length && first.loading ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
        ) : (
          <>
            <ul className="-mx-2 divide-y">
              {calls.map((c, i) => {
                const a = tr ? c.answers[tr]?.[sig] : undefined
                const Icon = CHANNEL_ICON[c.channel ?? ''] ?? Headset
                const review = Object.values(c.answers).some((t) => Object.values(t).some((x) => x.needs_review))
                return (
                  <li key={c.call_id}>
                    <button onClick={() => setOpen(i)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted">
                      <Icon size={16} className="shrink-0 text-muted-foreground" aria-label={c.channel ? channelLabel(c.channel) : undefined} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Mono>{c.external_id ?? `Call ${c.call_id}`}</Mono>
                          {review && <Warning size={12} weight="fill" className="text-warn" aria-label="Has answers that need review" />}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[c.metadata?.rep ?? [c.agent_id, c.agent_version].filter(Boolean).join(' '), c.started_at && new Date(c.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {a && <span className={cn('shrink-0 text-xs tabular-nums', a.needs_review ? 'text-warn' : 'text-muted-foreground')}>{pct(a.confidence)} sure</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            {ready && pages!.next && (
              <Button variant="outline" className="mt-4 w-full" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Show more (${num(pages!.total - calls.length)} left)`}
              </Button>
            )}
          </>
        )}
      </SidePanel>
      <CallPanel
        id={open !== undefined ? String(calls[open]?.call_id) : undefined}
        open={open !== undefined}
        trackers={trackers}
        onClose={() => setOpen(undefined)}
        onDeleted={() => {
          setPages((p) => p && { ...p, calls: p.calls.filter((_, i) => i !== open), total: p.total - 1 })
          setOpen(undefined)
        }}
        position={open !== undefined ? { at: open, of: calls.length } : undefined}
        onStep={(d) => setOpen((o) => (o === undefined ? o : Math.max(0, Math.min(calls.length - 1, o + d))))}
      />
    </>
  )
}
