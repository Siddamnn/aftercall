import { CaretDown, CaretRight, CaretUp, CheckCircle, DotsThree, DownloadSimple, GitBranch, ListBullets, Prohibit, StackSimple, Table, Trash, Warning } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from '../lib/toast'
import { deleteCall, deleteUpload, downloadExport, getCall, getResults, getUpload, listTrackers, listUploads, TOKEN_BUDGET, type Answer, type CallResult, type Signal, type Tracker } from '../api'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { explain } from '../conditions'
import { ConfirmDelete } from '../confirm-delete'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { channelLabel, humanize, money, num, pct, plural, title } from '../lib/format'
import { progressKey, STATUS_POLL_MS, useLoad, usePolling, useSticky } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { EmptyState, ErrorNote, Meter, Mono, PageHeader, Segmented, SidePanel } from '../ui'

type Filter = 'all' | 'review' | 'skipped'
type View = 'list' | 'table'

const answersOf = (c: CallResult) => Object.values(c.answers).flatMap((qs) => Object.values(qs))
const reviewCount = (c: CallResult) => answersOf(c).filter((a) => a.needs_review).length
const skipped = (c: CallResult) => c.status === 'over_limit' || c.status === 'failed'
const pending = (c: CallResult) => c.status === 'queued' || c.status === 'processing' || c.status === 'transcribing'
const FILTERS: { id: Filter; label: string; test: (c: CallResult) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'review', label: 'Needs review', test: (c) => reviewCount(c) > 0 },
  { id: 'skipped', label: 'Skipped', test: skipped },
]

/** Score answers read as their level ("2 Frustrated"), not a bare float. */
function display(a: Answer, s?: Signal) {
  if (a.type !== 'score') return title(humanize(String(a.value)))
  const i = Math.round(a.value as number)
  const level = (s?.spec.criteria as string[] | undefined)?.[i]
  return level ? `${i} ${level.split(':')[0]}` : String(i)
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const VIEW_KEY = 'results-view'
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'list'
  } catch {
    return 'list'
  }
}

export default function Results() {
  const { uploadId, callId } = useParams()
  const navigate = useNavigate()
  const uploads = useLoad(listUploads, [])
  const trackers = useLoad(listTrackers, [])
  const id = uploadId ?? ''
  const results = useLoad(() => (id ? getResults(id) : Promise.resolve([])), [id])
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Not remembered; fine.
    }
  }

  const running = !!results.data?.some(pending)
  const { reload } = results
  const reloadUploads = uploads.reload
  const lastProgress = useRef<string | undefined>(undefined)
  // Only the upload's status (counts) is polled. The full results, which read every call, reload
  // when calls finish or fail, or when the upload completes.
  usePolling(async () => {
    const status = await getUpload(id)
    const key = progressKey(status)
    const changed = lastProgress.current !== undefined && lastProgress.current !== key
    lastProgress.current = key
    if (changed || status.complete) {
      reload()
      reloadUploads()
    }
    return !status.complete
  }, STATUS_POLL_MS, running && !!id)
  useEffect(() => {
    lastProgress.current = undefined
  }, [id, running])

  const { last } = useSticky(callId)
  const [deletingUpload, setDeletingUpload] = useState(false)

  if (!uploadId && uploads.data?.length) return <Navigate to={`/results/${uploads.data[0].upload_id}`} replace />

  if (uploads.data?.length === 0) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState
          icon={<Table size={22} aria-hidden />}
          title="No results yet"
          action={<Button asChild><Link to="/analyse">Analyse calls</Link></Button>}
        >
          Analyse a file of calls and every answer shows up here, with how sure the AI was.
        </EmptyState>
      </>
    )
  }

  const upload = uploads.data?.find((u) => u.upload_id === id)
  const rows = results.data ?? []
  const shown = rows.filter(FILTERS.find((f) => f.id === filter)!.test)
  const sIndex = new Map((trackers.data ?? []).flatMap((t) => t.signals.map((s) => [`${t.name}.${s.name}`, s] as const)))

  // Columns: the upload's trackers, each with its signals (the ones answered, plus any
  // active ones not answered yet), grouped under the tracker.
  const groups = (upload?.trackers ?? []).map((tr) => {
    const answered = rows.flatMap((r) => Object.keys(r.answers[tr] ?? {}))
    const activeNow = trackers.data?.find((t) => t.name === tr)?.signals.filter((s) => s.active).map((s) => s.name) ?? []
    return { tr, signals: [...new Set([...answered, ...activeNow])] }
  })
  const cols = groups.flatMap((g) => g.signals.map((s) => ({ tr: g.tr, s })))
  const review = rows.filter((c) => reviewCount(c) > 0).length
  const skippedN = rows.filter(skipped).length

  // Previous / next call in the panel follow what's on screen.
  const at = shown.findIndex((c) => c.call_id === callId)
  const step = (d: number) => {
    const c = shown[at + d]
    if (c) navigate(`/results/${id}/${c.call_id}`, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Results"
        actions={
          id && (
            <>
              <Button variant="outline" size="lg" onClick={() => toast.promise(downloadExport(id), { loading: 'Preparing CSV…', success: 'CSV downloaded', error: (e: Error) => e.message })}>
                <DownloadSimple aria-hidden /> Export CSV
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="size-10" aria-label="More for this upload"><DotsThree size={18} weight="bold" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeletingUpload(true)}><Trash aria-hidden /> Delete upload</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select value={id ? String(id) : undefined} onValueChange={(v) => navigate(`/results/${v}`)}>
          <SelectTrigger className="h-9 min-w-64 bg-card font-medium shadow-panel" aria-label="Upload">
            <SelectValue placeholder="Choose an upload" />
          </SelectTrigger>
          <SelectContent>
            {uploads.data?.map((u) => (
              <SelectItem key={u.upload_id} value={String(u.upload_id)}>
                {u.filename} <span className="text-muted-foreground">{shortDate(u.created_at)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {results.data && (
          <p className="text-sm text-ink-2" aria-live="polite">
            {upload && !upload.complete ? (
              <span className="inline-flex items-center gap-2">
                <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-primary/60" /><span className="relative size-2 rounded-full bg-primary" /></span>
                {upload.counts.transcribing ? 'Transcribing and analysing' : 'Analysing'}: {upload.counts.done} of {upload.counts.done + upload.counts.queued + upload.counts.processing + (upload.counts.transcribing ?? 0)} done
              </span>
            ) : (
              <>
                {plural(rows.length, 'call')}
                {review > 0 && <>, <span className="font-medium text-warn">{review} to review</span></>}
                {skippedN > 0 && <>, {skippedN} skipped</>}
                {upload && <span className="text-muted-foreground">. Checked for {upload.trackers.map(title).join(', ')}</span>}
              </>
            )}
          </p>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          id="results-filter"
          label="Show"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f.id,
            label: <>{f.label} <span className="ml-0.5 text-muted-foreground tabular-nums">{rows.filter(f.test).length}</span></>,
          }))}
        />
        <Segmented
          id="results-view"
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: <span className="inline-flex items-center gap-1.5"><ListBullets size={14} aria-hidden /> Calls</span> },
            { value: 'table', label: <span className="inline-flex items-center gap-1.5"><Table size={14} aria-hidden /> Every answer</span> },
          ]}
        />
      </div>

      {results.error && <ErrorNote onRetry={reload} className="mb-4">Couldn't load results. {results.error}</ErrorNote>}

      {results.loading && !results.data ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : view === 'list' ? (
        <CallList rows={shown} cols={cols} sIndex={sIndex} uploadId={id} selected={callId} />
      ) : (
        <Grid rows={shown} groups={groups} cols={cols} sIndex={sIndex} uploadId={id} selected={callId} trackers={trackers.data ?? []} />
      )}
      {results.data && shown.length === 0 && (
        <p className="py-12 text-center text-ink-2">{filter === 'review' ? 'Nothing needs review here.' : 'No calls here.'}</p>
      )}

      <ConfirmDelete
        open={deletingUpload}
        onOpenChange={setDeletingUpload}
        title={`Delete ${upload?.filename ?? 'this upload'}?`}
        onConfirm={async () => {
          await deleteUpload(id)
          toast.success(`Deleted ${upload?.filename ?? 'the upload'}`)
          reloadUploads()
          navigate('/results', { replace: true })
        }}
      >
        This deletes its {plural(rows.length, 'call')} for good: transcripts, call IDs and answers. It can't be undone. Tokens already used stay on your usage.
      </ConfirmDelete>

      <CallPanel
        id={last}
        open={!!callId}
        trackers={trackers.data ?? []}
        onDeleted={() => {
          reload()
          reloadUploads()
          navigate(`/results/${id}`)
        }}
        onClose={() => navigate(`/results/${id}`)}
        position={at >= 0 ? { at, of: shown.length } : undefined}
        onStep={step}
      />
    </>
  )
}

type Col = { tr: string; s: string }

/** The default view: one row per call, its status, and its answers as label-value pairs. */
function CallList({ rows, cols, sIndex, uploadId, selected }: { rows: CallResult[]; cols: Col[]; sIndex: Map<string, Signal>; uploadId: string; selected?: string }) {
  if (!rows.length) return null
  return (
    <ul className="surface divide-y overflow-hidden">
      {rows.map((c, i) => {
        const n = reviewCount(c)
        return (
          <motion.li key={c.call_id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease, delay: Math.min(i, 8) * 0.03 }}>
            <Link
              to={`/results/${uploadId}/${c.call_id}`}
              className={cn('group grid gap-x-6 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/50 sm:grid-cols-[11rem_1fr_auto] sm:items-center sm:px-5', String(c.call_id) === selected && 'bg-muted/50')}
            >
              <span className="min-w-0">
                <Mono className="block truncate font-medium">{c.external_id ?? `Call ${c.call_id}`}</Mono>
                <span className="block truncate text-xs text-muted-foreground">{[c.agent_id, c.agent_version].filter(Boolean).join(' ')}</span>
              </span>
              <span className="flex min-w-0 flex-wrap gap-x-5 gap-y-1.5">
                {skipped(c) ? (
                  <span className="text-sm text-muted-foreground">{c.status === 'failed' ? "Couldn't be analysed. Not charged." : `Longer than ${num(TOKEN_BUDGET)} tokens, so it was skipped. Not charged.`}</span>
                ) : pending(c) ? (
                  <span className={cn('text-sm text-muted-foreground', (c.status === 'processing' || c.status === 'transcribing') && 'shimmer-text font-medium')}>{c.status === 'processing' ? 'Analysing…' : c.status === 'transcribing' ? 'Transcribing…' : 'Waiting'}</span>
                ) : (
                  cols.slice(0, 5).map(({ tr, s }) => {
                    const a = c.answers[tr]?.[s]
                    if (!a) return null
                    return (
                      <span key={`${tr}.${s}`} className="min-w-0 text-sm leading-tight">
                        <span className="block truncate text-xs text-muted-foreground">{title(s)}</span>
                        <span className={cn('font-medium', a.needs_review && 'text-warn')}>
                          {display(a, sIndex.get(`${tr}.${s}`))}
                          {a.needs_review && <Warning size={12} weight="fill" className="ml-1 inline align-[-1px]" aria-label="needs review" />}
                        </span>
                      </span>
                    )
                  })
                )}
              </span>
              <span className="flex items-center gap-2 sm:justify-end">
                {c.large && (
                  <Tooltip>
                    <TooltipTrigger asChild><StackSimple size={16} weight="fill" className="text-warn" aria-label={`Sent in ${c.requests} parts`} /></TooltipTrigger>
                    <TooltipContent>Long call, sent in {c.requests} parts</TooltipContent>
                  </Tooltip>
                )}
                <Status c={c} n={n} />
                <CaretRight size={14} className="hidden text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden />
              </span>
            </Link>
          </motion.li>
        )
      })}
    </ul>
  )
}

function Status({ c, n }: { c: CallResult; n: number }) {
  if (skipped(c)) return <Pill className="bg-muted text-muted-foreground"><Prohibit size={12} weight="bold" aria-hidden /> Skipped</Pill>
  if (pending(c)) return null
  if (n) return <Pill className="bg-warn-soft text-warn"><Warning size={12} weight="fill" aria-hidden /> {n} to review</Pill>
  return <Pill className="bg-ok-soft text-ok"><CheckCircle size={12} weight="fill" aria-hidden /> All clear</Pill>
}

const Pill = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap', className)}>{children}</span>
)

/** Every answer: one column per signal, grouped under its tracker. */
function Grid({ rows, groups, cols, sIndex, uploadId, selected, trackers }: {
  rows: CallResult[]
  trackers: Tracker[]
  groups: { tr: string; signals: string[] }[]
  cols: Col[]
  sIndex: Map<string, Signal>
  uploadId: string
  selected?: string
}) {
  const navigate = useNavigate()
  const starts = (i: number) => i === 0 || cols[i - 1].tr !== cols[i].tr
  if (!rows.length) return null
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" rowSpan={2} className="sticky left-0 z-[1] border-b bg-card px-4 py-3 align-bottom font-medium">Call</th>
            {groups.map((g) => (
              <th key={g.tr} scope="colgroup" colSpan={g.signals.length} className="border-b border-l px-4 pt-3 pb-1.5 text-xs font-semibold text-foreground">{title(g.tr)}</th>
            ))}
            <th scope="col" rowSpan={2} className="border-b border-l px-4 py-3 text-right align-bottom font-medium">Tokens</th>
          </tr>
          <tr className="text-muted-foreground">
            {cols.map(({ tr, s }, i) => (
              <th key={`${tr}.${s}`} scope="col" className={cn('border-b px-4 pb-3 font-medium', starts(i) && 'border-l')}>{title(s)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <motion.tr
              key={c.call_id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease, delay: Math.min(i, 8) * 0.03 }}
              onClick={() => navigate(`/results/${uploadId}/${c.call_id}`)}
              className={cn('group cursor-pointer border-b align-top transition-colors duration-150 last:border-0 hover:bg-muted/50', String(c.call_id) === selected && 'bg-muted/50')}
            >
              <th scope="row" className="sticky left-0 z-[1] bg-card px-4 py-3 font-normal transition-colors duration-150 group-hover:bg-muted">
                <Link to={`/results/${uploadId}/${c.call_id}`} className="font-medium underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
                  <Mono>{c.external_id ?? `Call ${c.call_id}`}</Mono>
                </Link>
                <div className="text-xs text-muted-foreground">{[c.agent_id, c.agent_version].filter(Boolean).join(' ')}</div>
              </th>
              {skipped(c) ? (
                <td colSpan={cols.length} className="border-l px-4 py-3 text-muted-foreground">
                  {c.status === 'failed' ? "Couldn't be analysed. Not charged." : `Longer than ${num(TOKEN_BUDGET)} tokens, so it was skipped. Not charged.`}
                </td>
              ) : (
                cols.map(({ tr, s }, j) => {
                  const a = c.answers[tr]?.[s]
                  if (!a) {
                    const check = c.conditions?.[tr]
                    return (
                      <td key={`${tr}.${s}`} className={cn('px-4 py-3', starts(j) && 'border-l')}>
                        {c.status !== 'done' ? <div className="skeleton mt-1 h-4 w-20" />
                          : check && !check.met ? (
                            <Tooltip>
                              <TooltipTrigger className="inline-flex items-center gap-1 text-muted-foreground"><GitBranch size={12} aria-hidden /> Didn't run</TooltipTrigger>
                              <TooltipContent className="max-w-64">{explain(check, trackers)}</TooltipContent>
                            </Tooltip>
                          ) : <span className="text-muted-foreground">Not checked</span>}
                      </td>
                    )
                  }
                  return (
                    <td key={`${tr}.${s}`} className={cn('px-4 py-3', starts(j) && 'border-l', a.needs_review && 'bg-warn-soft')}>
                      <div className="font-medium">{display(a, sIndex.get(`${tr}.${s}`))}</div>
                      <div className={cn('mt-1 flex items-center gap-2 text-xs tabular-nums', a.needs_review ? 'text-warn' : 'text-muted-foreground')}>
                        <Meter value={a.confidence} review={a.needs_review} className="w-12" />
                        {pct(a.confidence)}
                        {a.needs_review && <Warning size={12} weight="fill" aria-label="Needs review" />}
                      </div>
                    </td>
                  )
                })
              )}
              <td className="border-l px-4 py-3 text-right tabular-nums">
                {c.status === 'done' ? num(c.tokens.billed_input) : <span className="text-muted-foreground">0</span>}
                {c.large && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
                    <StackSimple size={12} weight="fill" aria-hidden /> {c.estimate.requests} parts
                  </div>
                )}
                {c.cost !== null && <div className="text-xs text-muted-foreground">{money(c.cost)}</div>}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CallPanel({ id, open, trackers, onClose, onDeleted, position, onStep }: {
  id?: string
  open: boolean
  trackers: Tracker[]
  onClose: () => void
  onDeleted: () => void
  position?: { at: number; of: number }
  onStep: (d: number) => void
}) {
  const call = useLoad(() => (id ? getCall(id) : Promise.resolve(undefined)), [id])
  const c = call.data
  const signal = (tr: string, name: string) => trackers.find((x) => x.name === tr)?.signals.find((s) => s.name === name)
  const [deleting, setDeleting] = useState(false)
  // Trackers with answers, then conditional ones that didn't run, in the call's order.
  const sections = c ? [...new Set([...c.trackers, ...Object.keys(c.answers)])].filter((tr) => c.answers[tr] || c.conditions?.[tr]) : []

  // j / k step through calls, like a mail client.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'j') onStep(1)
      if (e.key === 'k') onStep(-1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, onStep])

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={c ? <Mono>{c.external_id ?? `Call ${c.call_id}`}</Mono> : 'Call'}
      subtitle={c && [
        [c.agent_id, c.agent_version].filter(Boolean).join(' '),
        c.started_at && new Date(c.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      ].filter(Boolean).join(', ')}
      footer={(position || c) && (
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {c && (
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-stop" onClick={() => setDeleting(true)} aria-label="Delete this call" title="Delete this call">
                <Trash aria-hidden />
              </Button>
            )}
            {position && <span className="text-sm text-muted-foreground tabular-nums">{position.at + 1} of {position.of}</span>}
          </span>
          {position && (
          <span className="flex items-center gap-1.5">
            <span className="mr-1 hidden text-xs text-muted-foreground sm:inline"><kbd className="font-sans">J</kbd> <kbd className="font-sans">K</kbd></span>
            <Button variant="outline" size="icon" disabled={position.at === 0} onClick={() => onStep(-1)} aria-label="Previous call"><CaretUp aria-hidden /></Button>
            <Button variant="outline" size="icon" disabled={position.at === position.of - 1} onClick={() => onStep(1)} aria-label="Next call"><CaretDown aria-hidden /></Button>
          </span>
          )}
        </div>
      )}
    >
      <ConfirmDelete
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${c?.external_id ?? 'this call'}?`}
        onConfirm={async () => {
          await deleteCall(c!.call_id)
          toast.success(`Deleted ${c?.external_id ?? 'the call'}`)
          onDeleted()
        }}
      >
        This deletes the call's transcript, IDs and answers for good. It can't be undone. Tokens it already used stay on your usage, and you can upload the same call again.
      </ConfirmDelete>
      {call.loading && !c ? (
        <div className="space-y-4" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
        </div>
      ) : call.error ? (
        <ErrorNote onRetry={call.reload}>{call.error}</ErrorNote>
      ) : c && (
        <motion.div key={c.call_id} className="space-y-9" initial={{ opacity: 0, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.25 }}>
          {c.warning && <p className="rounded-xl border border-warn/25 bg-warn-soft p-4 text-[0.9375rem] leading-relaxed">{c.warning}</p>}
          {c.message && <p className="rounded-xl border border-stop/20 bg-stop-soft p-4 text-[0.9375rem] leading-relaxed">{c.message}</p>}
          {(c.channel || Object.keys(c.metadata ?? {}).length > 0) && (
            <dl className="-mt-3 flex flex-wrap gap-1.5 text-xs">
              {[...(c.channel ? [['Channel', channelLabel(c.channel)]] : []), ...Object.entries(c.metadata ?? {}).map(([k, v]) => [title(k), v])].map(([k, v]) => (
                <div key={k} className="flex gap-1 rounded-md border bg-muted/50 px-2 py-1">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {pending(c) && (
            <p className={cn('text-ink-2', (c.status === 'processing' || c.status === 'transcribing') && 'shimmer-text font-medium')}>
              {c.status === 'processing' ? 'Analysing this call…' : c.status === 'transcribing' ? 'Gemini is transcribing this recording. Analysis starts when the transcript is ready.' : "This call hasn't been analysed yet. Answers appear here when it's done."}
            </p>
          )}

          {sections.map((tr) => {
            const as = c.answers[tr]
            const check = c.conditions?.[tr]
            return (
              <section key={tr} aria-labelledby={`tr-${tr}`}>
                <h3 id={`tr-${tr}`} className={cn('flex items-center gap-2 text-sm font-semibold', check ? 'mb-1.5' : 'mb-4', !as && 'text-muted-foreground')}>
                  {title(tr)}
                  {check && !as && <span className="font-normal">didn't run</span>}
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </h3>
                {check && (
                  <p className={cn('flex items-start gap-1.5 text-sm', as ? 'mb-4 text-muted-foreground' : 'text-ink-2')}>
                    <GitBranch size={14} className="mt-0.5 shrink-0" aria-hidden /> {explain(check, trackers)}
                  </p>
                )}
                {as && (
                  <ul className="space-y-6">
                    {Object.entries(as)
                      .sort(([, x], [, y]) => Number(y.needs_review) - Number(x.needs_review))
                      .map(([name, a]) => <AnswerBlock key={name} name={name} a={a} s={signal(tr, name)} />)}
                  </ul>
                )}
              </section>
            )
          })}

          {c.transcript && <Transcript text={c.transcript} />}

          <Details label="Usage">
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {[
                ['Transcript', `${num(c.tokens.transcript)} tokens`],
                ['Estimated', c.estimate.tokens === null ? 'None' : `${num(c.estimate.tokens)} tokens`],
                ['Billed', `${num(c.tokens.billed_input)} tokens`],
                ['Requests', num(c.requests)],
                ...(c.cost !== null ? [['Cost', money(c.cost)]] : []),
                ...(c.model ? [['Model', c.model]] : []),
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-muted/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Details>
        </motion.div>
      )}
    </SidePanel>
  )
}

function Details({ label, children, defaultOpen }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-semibold">
        <CaretRight size={12} weight="bold" className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pt-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The answer and how sure the AI was up front; the likelihood of every other answer folds away. */
function AnswerBlock({ name, a, s }: { name: string; a: Answer; s?: Signal }) {
  const [open, setOpen] = useState(a.needs_review)
  const threshold = s?.spec.review_threshold ?? 0.6
  const entries = Object.entries(a.probabilities)
  if (a.type !== 'score') entries.sort((x, y) => y[1] - x[1])
  const top = a.type === 'score' ? String(Math.round(a.value as number)) : String(a.value)
  const label = (k: string) => {
    if (a.type !== 'score') return title(humanize(k))
    const level = (s?.spec.criteria as string[] | undefined)?.[+k]
    return level ? `${k} ${level.split(':')[0]}` : k
  }
  return (
    <li className={cn(a.needs_review && '-mx-3 rounded-xl bg-warn-soft px-3 py-3')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{title(name)}</span>
        {a.needs_review && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
            <Warning size={12} weight="fill" aria-hidden /> Needs review
          </span>
        )}
      </div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="group mt-0.5 flex w-full items-center gap-3 text-left">
        <span className="text-lg font-semibold tracking-tight">{display(a, s)}</span>
        <Meter value={a.confidence} review={a.needs_review} className="w-16" />
        <span className={cn('text-sm tabular-nums', a.needs_review ? 'text-warn' : 'text-muted-foreground')}>{pct(a.confidence)} sure</span>
        <CaretDown size={12} weight="bold" className={cn('ml-auto text-muted-foreground transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        <span className="sr-only">{open ? 'Hide' : 'Show'} other answers</span>
      </button>
      <motion.div initial={false} animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }} transition={{ duration: open ? 0.25 : 0.15, ease }} className="overflow-hidden">
        <ul className="space-y-1.5 pt-3" aria-label="Likelihood of each answer">
          {entries.slice(0, 6).map(([k, p], i) => (
            <li key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
              <span className={cn('truncate', k === top ? 'font-medium' : 'text-ink-2')}>{label(k)}</span>
              <span className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.span
                  className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full', k === top ? (a.needs_review ? 'bg-warn' : 'bg-primary') : 'bg-muted-foreground/35')}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: open ? Math.max(p, 0.01) : 0 }}
                  transition={{ duration: 0.5, ease, delay: i * 0.04 }}
                />
              </span>
              <span className="text-right text-muted-foreground tabular-nums">{pct(p)}</span>
            </li>
          ))}
        </ul>
        {a.needs_review && <p className="mt-2 text-sm text-ink-2">Flagged because it's below this signal's {pct(threshold)} review line.</p>}
      </motion.div>
    </li>
  )
}

function Transcript({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  const turns = text.split('\n').map((line) => {
    const i = line.indexOf(': ')
    return i > 0 ? { who: line.slice(0, i), said: line.slice(i + 2) } : { who: '', said: line }
  })
  const shown = all ? turns : turns.slice(0, 40)
  return (
    <Details label={<>Transcript <span className="font-normal text-muted-foreground">{plural(turns.length, 'turn')}</span></>}>
      <ol className="space-y-3">
        {shown.map((t, i) => {
          const caller = t.who === 'caller' || t.who === 'user'
          return (
            <li key={i} className={cn('flex flex-col', caller ? 'items-end' : 'items-start')}>
              <span className="mb-0.5 px-1 text-xs text-muted-foreground capitalize">{t.who}</span>
              <p lang="hi-Latn" className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-relaxed', caller ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted')}>
                {t.said}
              </p>
            </li>
          )
        })}
      </ol>
      {turns.length > shown.length && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setAll(true)}>
          Show all {num(turns.length)} turns
        </Button>
      )}
    </Details>
  )
}
