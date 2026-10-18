import {
  ChartBar, DownloadSimple, Faders, FileCsv, FileImage, GitBranch, Link as LinkIcon, Plus, Printer, PushPin, SquaresFour, Table, Warning,
} from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { ProBadge, ProDialog, useFeature } from '../people'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from '../lib/toast'
import {
  createDashboard, exportCalls, getDashboard, getDimensions, getInsights, listDashboards, listTrackers, saveDashboard, USING_MOCK,
  type Dashboard, type Insights as InsightsData, type InsightScope, type SignalInsight, type Tracker,
} from '../api'
import { Button } from '../components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { makeWidget, recommended, signalMeta } from '../dashboard/model'
import { DrillDown, type Drill } from '../drill-down'
import { fileSlug, saveCsv, savePng } from '../lib/export'
import { compact, money, pct, plural, title } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Delta, rangeLabel, rangeOf, ScopeBar, scopeOf, shiftBack, valueLabel, whereLabel, type Range } from '../scope'
import { Bars, Columns, DataTable, rowsOf, SplitBar, type Row } from '../signal-charts'
import { EmptyState, ErrorNote, Mono, Num, PageHeader, TypeTag } from '../ui'

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Insights() {
  const [params, setParams] = useSearchParams()
  const scope = scopeOf(params)
  const key = JSON.stringify(scope)
  const previous = shiftBack(scope)
  const trackers = useLoad(listTrackers, [])
  const dims = useLoad(getDimensions, [])
  const data = useLoad(() => getInsights(scope), [key])
  const prev = useLoad(() => (previous ? getInsights(previous) : Promise.resolve(undefined)), [key])
  const [drill, setDrill] = useState<Drill>()
  const range = rangeOf(params)
  const dashboards = useLoad(listDashboards, [])
  const pageRef = useRef<HTMLDivElement>(null)

  const update = (fn: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }

  if (data.error && !data.data) {
    return (
      <>
        <PageHeader title="Insights">What your conversations are saying, across every upload.</PageHeader>
        <ErrorNote onRetry={data.reload}>
          {USING_MOCK ? data.error : (
            <>Insights couldn't load. Check that the API is running, or run the UI with <Mono>VITE_API_MOCK=true</Mono>. <span className="text-muted-foreground">({data.error})</span></>
          )}
        </ErrorNote>
      </>
    )
  }

  const byTracker = new Map<string, SignalInsight[]>()
  for (const s of data.data?.signals ?? []) byTracker.set(s.tracker, [...(byTracker.get(s.tracker) ?? []), s])
  const prevOf = (s: SignalInsight) => prev.data?.signals.find((x) => x.tracker === s.tracker && x.signal === s.signal)
  const refetching = data.loading && !!data.data
  const where = (w: string): InsightScope => ({ ...scope, where: [...(scope.where ?? []), w] })

  return (
    <div ref={pageRef}>
      <PageHeader
        title="Insights"
        actions={data.data && data.data.signals.length > 0 && (
          <ExportMenu data={data.data} prev={prev.data} scope={scope} range={range} trackers={trackers.data ?? []} page={pageRef} />
        )}
      >
        What your conversations are saying, across every upload.
      </PageHeader>

      <ScopeBar
        range={range}
        dims={dims.data}
        params={params}
        trackers={trackers.data ?? []}
        update={update}
      />

      {!data.data ? (
        <div className="mt-6 space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-64 rounded-xl" />)}</div>
        </div>
      ) : data.data.signals.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={<SquaresFour size={22} aria-hidden />} title="Nothing to show yet" action={<Button asChild><Link to="/trackers">Set up a tracker</Link></Button>}>
            Insights shows the answers to your trackers' signals. Add a tracker, analyse some conversations, and they'll appear here.
          </EmptyState>
        </div>
      ) : data.data.scope.calls === 0 ? (
        <div className="mt-6">
          <EmptyState icon={<Faders size={22} aria-hidden />} title="No conversations match" action={<Button variant="outline" onClick={() => setParams(new URLSearchParams({ range: 'all' }), { replace: true })}>Clear filters</Button>}>
            Nothing in this time range matches the filters. Widen the range or remove a filter.
          </EmptyState>
        </div>
      ) : (
        <div className={cn('transition-opacity duration-200', refetching && 'opacity-60')} aria-busy={refetching}>
          <Kpis scope={data.data.scope} range={range} />
          <div className="mt-10 space-y-12">
            {[...byTracker.entries()].map(([tr, signals]) => {
              const t = trackers.data?.find((x) => x.name === tr)
              const s0 = signals[0]
              return (
                <section key={tr} aria-labelledby={`ins-${tr}`}>
                  <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={`ins-${tr}`} className="text-lg font-semibold tracking-tight">{title(tr)}</h2>
                    {t?.description && <p className="text-sm text-ink-2">{t.description}</p>}
                    {s0.not_run > 0 && t?.run_if && (
                      <p className="flex items-center gap-1 text-sm text-muted-foreground">
                        <GitBranch size={13} aria-hidden /> Ran on {pct(s0.ran / (s0.ran + s0.not_run))}, only when {whereLabel(`${t.run_if.tracker}.${t.run_if.signal}:${Array.isArray(t.run_if.value) ? t.run_if.value.join(' or ') : t.run_if.value}`, trackers.data ?? []).toLowerCase()}
                      </p>
                    )}
                  </header>
                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {signals.map((s, i) => (
                      <motion.li key={s.signal} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: Math.min(i, 5) * 0.04 }}>
                        <SignalCard
                          s={s}
                          prev={prevOf(s)}
                          rangeLabel={rangeLabel(range)}
                          onDrill={(value, label) => setDrill({ label, scope: where(`${s.tracker}.${s.signal}:${value}`), signal: `${s.tracker}.${s.signal}` })}
                          onFilter={(value) => update((p) => p.append('where', `${s.tracker}.${s.signal}:${value}`))}
                          pin={<PinMenu s={s} trackers={trackers.data ?? []} dashboards={dashboards} params={params} />}
                        />
                      </motion.li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </div>
      )}

      <DrillDown drill={drill} trackers={trackers.data ?? []} onClose={() => setDrill(undefined)} />
    </div>
  )
}

// ── KPI row ────────────────────────────────────────────────────────────────────

function Kpis({ scope, range }: { scope: InsightsData['scope']; range: Range }) {
  const change = scope.calls_previous ? (scope.calls - scope.calls_previous) / scope.calls_previous : null
  const tiles: { label: string; value: ReactNode; note?: ReactNode }[] = [
    {
      label: 'Conversations',
      value: <Num value={scope.calls} className="[font-variant-numeric:normal]" />,
      note: change !== null && range !== 'all' ? <Delta value={change * 100} unit="%" suffix={`vs previous ${range} days`} /> : null,
    },
    { label: 'Answers', value: <Num value={scope.answers} className="[font-variant-numeric:normal]" /> },
    {
      label: 'Need review',
      value: <Num value={scope.needs_review} className="[font-variant-numeric:normal]" />,
      note: scope.answers ? <span className="flex items-center gap-1"><Warning size={12} weight="fill" className="text-warn" aria-hidden />{pct(scope.needs_review / scope.answers)} of answers</span> : null,
    },
    { label: 'Tokens used', value: compact(scope.tokens), note: scope.cost !== null ? money(scope.cost) : 'Priced per token' },
  ]
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="surface p-4">
          <dt className="text-sm text-muted-foreground">{t.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight">{t.value}</dd>
          {t.note && <dd className="mt-1 text-xs text-muted-foreground">{t.note}</dd>}
        </div>
      ))}
    </dl>
  )
}

// ── Signal card ────────────────────────────────────────────────────────────────

function SignalCard({ s, prev, rangeLabel, onDrill, onFilter, pin }: {
  s: SignalInsight
  prev?: SignalInsight
  rangeLabel: string
  onDrill: (value: string, label: string) => void
  onFilter: (value: string) => void
  pin: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const n = s.answered
  const rows = rowsOf(s, s.counts, n)
  const prevShare = (key: string) => (prev && prev.answered >= 30 ? (prev.counts[key] ?? 0) / prev.answered : null)
  const comparable = n >= 30 && prev && prev.answered >= 30

  // The headline: yes rate, the top option, or the average score.
  let headline: ReactNode, sub: ReactNode, delta: ReactNode = null
  if (s.type === 'yes_no') {
    const y = rows.find((r) => r.key === 'yes')!
    headline = pct(y.share)
    sub = 'said yes'
    const p = prevShare('yes')
    if (comparable && p !== null) delta = <Delta value={(y.share - p) * 100} unit=" pts" />
  } else if (s.type === 'score') {
    headline = s.mean !== null ? s.mean.toFixed(1) : '–'
    sub = s.mean !== null ? `average · ${s.levels?.[String(Math.round(s.mean))] ?? ''}` : 'average'
    if (comparable && s.mean !== null && prev!.mean !== null) delta = <Delta value={s.mean - prev!.mean} unit="" />
  } else {
    const top = [...rows].filter((r) => !r.vague).sort((a, b) => b.count - a.count)[0] ?? rows[0]
    headline = pct(top.share)
    sub = top.label
    const p = prevShare(top.key)
    if (comparable && p !== null) delta = <Delta value={(top.share - p) * 100} unit=" pts" />
  }

  const vagueShare = rows.filter((r) => r.key === 'other' || r.key === 'not_stated').reduce((a, r) => a + r.share, 0)
  const versions = Object.keys(s.versions).sort()
  const drill = (r: Row) => onDrill(r.key, `${title(s.signal)} is ${r.label}`)

  return (
    <article className="surface flex h-full flex-col p-4" aria-labelledby={`card-${s.tracker}-${s.signal}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`card-${s.tracker}-${s.signal}`} className="truncate font-semibold tracking-tight">{title(s.signal)}</h3>
          <div className="mt-1 flex items-center gap-1.5">
            <TypeTag type={s.type} className="h-4.5 px-1 text-[0.6875rem]" />
            {versions.length > 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex h-4.5 items-center gap-1 rounded-md border border-warn/30 bg-warn-soft px-1 text-[0.6875rem] font-medium text-ink-2">
                    <span className="size-1.5 rounded-full bg-warn" aria-hidden />v{versions.join(' + v')}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-60">Answers from more than one version of this signal. Filter to current signal versions to compare like with like.</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center print:hidden">
          {pin}
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => setAsTable((t) => !t)} aria-label={asTable ? 'Show as chart' : 'Show as table'} title={asTable ? 'Show as chart' : 'Show as table'}>
            {asTable ? <ChartBar aria-hidden /> : <Table aria-hidden />}
          </Button>
        </div>
      </header>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-[-0.03em]">{headline}</span>
        <span className="min-w-0 truncate text-sm text-ink-2">{sub}</span>
      </div>
      <p className="h-4 text-xs text-muted-foreground">
        {n < 30 ? 'Too few to compare' : delta && <>{delta} <span>vs previous {rangeLabel.toLowerCase()}</span></>}
      </p>

      <div className="mt-4 flex-1">
        {asTable ? <DataTable rows={rows} /> : s.type === 'yes_no' ? <SplitBar rows={rows} n={n} onDrill={drill} onFilter={onFilter} />
          : s.type === 'score' ? <Columns rows={rows} n={n} onDrill={drill} onFilter={onFilter} />
          : <Bars rows={rows} n={n} onDrill={drill} onFilter={onFilter} />}
      </div>

      {s.type === 'choice' && vagueShare > 0.2 && n >= 30 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-ink-2">
          <Warning size={13} weight="fill" className="mt-px shrink-0 text-warn" aria-hidden />
          Other and Not stated are {pct(vagueShare)}. This signal may be missing an option.
        </p>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>{plural(n, 'answer')}</span>
        {s.needs_review > 0 && (
          <span className="flex items-center gap-1"><Warning size={11} weight="fill" className="text-warn" aria-hidden />{pct(s.needs_review / Math.max(1, n))} need review</span>
        )}
        {n > 0 && <span>{pct(s.confidence.mean)} avg confidence</span>}
      </footer>
    </article>
  )
}


// ── Add a card to a dashboard ──────────────────────────────────────────────────

function PinMenu({ s, trackers, dashboards, params }: {
  s: SignalInsight
  trackers: Tracker[]
  dashboards: { data?: Dashboard[]; error?: string; reload: () => void }
  params: URLSearchParams
}) {
  const navigate = useNavigate()
  const ref = `${s.tracker}.${s.signal}`
  const widget = () => makeWidget(recommended(signalMeta(trackers, ref)), ref, trackers)

  const addTo = async (d: Dashboard) => {
    try {
      const cur = await getDashboard(d.id)
      await saveDashboard(d.id, { ...cur, widgets: [...cur.widgets, widget()] })
      toast.success(`Added ${title(s.signal)} to ${d.name}`, { action: { label: 'Open', onClick: () => navigate(`/dashboards/${d.id}`) } })
      dashboards.reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const addToNew = async () => {
    try {
      const d = await createDashboard({ name: title(s.signal), description: null, params: params.toString() || 'range=30', widgets: [widget()] })
      navigate(`/dashboards/${d.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Add to a dashboard">
              <PushPin aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Add to a dashboard</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Add {title(s.signal)} to</DropdownMenuLabel>
        {dashboards.error ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Dashboards couldn't load.</p>
        ) : dashboards.data?.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={() => addTo(d)}>
            <SquaresFour aria-hidden /> <span className="truncate">{d.name}</span>
          </DropdownMenuItem>
        ))}
        {!dashboards.error && (
          <>
            {!!dashboards.data?.length && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={addToNew}><Plus aria-hidden /> New dashboard</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Export ─────────────────────────────────────────────────────────────────────

/** Every card's numbers in one long table: a row per signal and answer. */
function insightsCsv(data: InsightsData, prev: InsightsData | undefined, trackers: Tracker[]) {
  const rows: (string | number | null)[][] = [[
    'tracker', 'signal', 'type', 'answer_key', 'answer', 'conversations', 'share', 'answered', 'needs_review', 'avg_confidence', 'share_previous_period',
  ]]
  for (const s of data.signals) {
    const p = prev?.signals.find((x) => x.tracker === s.tracker && x.signal === s.signal)
    for (const [k, n] of Object.entries(s.counts)) {
      rows.push([
        s.tracker, s.signal, s.type, k, valueLabel(s.type, k, s.levels), n, s.answered ? +(n / s.answered).toFixed(4) : null,
        s.answered, s.needs_review, +s.confidence.mean.toFixed(4), p?.answered ? +((p.counts[k] ?? 0) / p.answered).toFixed(4) : null,
      ])
    }
    if (s.type === 'score') rows.push([s.tracker, s.signal, s.type, 'mean', 'Average', null, s.mean === null ? null : +s.mean.toFixed(3), s.answered, s.needs_review, +s.confidence.mean.toFixed(4), p?.mean == null ? null : +p.mean.toFixed(3)])
  }
  void trackers
  return rows
}

function ExportMenu({ data, prev, scope, range, trackers, page }: {
  data: InsightsData
  prev?: InsightsData
  scope: InsightScope
  range: Range
  trackers: Tracker[]
  page: React.RefObject<HTMLDivElement | null>
}) {
  const stamp = `${range === 'all' ? 'all-time' : `last-${range}-days`}-${new Date().toISOString().slice(0, 10)}`
  // Every conversation at once is a bulk export: Pro (B48). The backend refuses it too (B49).
  const bulk = useFeature('bulk_export')
  const [pro, setPro] = useState(false)
  const run = (label: string, fn: () => Promise<void> | void) => async () => {
    try {
      await fn()
    } catch (e) {
      toast.error(`${label} failed: ${(e as Error).message}`)
    }
  }
  return (
    <>
    <ProDialog open={pro} onOpenChange={setPro} title="Exporting every conversation is part of Pro">
      On pay as you go, export one run’s results from Results, or this page’s summary as CSV. Pro exports every conversation in a view at once, with every answer.
    </ProDialog>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="print:hidden"><DownloadSimple aria-hidden /> Export</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={run('Export', () => saveCsv(insightsCsv(data, prev, trackers), `aftercall-insights-${stamp}.csv`))}>
          <FileCsv aria-hidden />
          <span className="flex flex-col"><span>Summary as CSV</span><span className="text-xs text-muted-foreground">Every card's numbers, with this view's filters</span></span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={!bulk ? () => setPro(true) : run('Export', async () => {
          const id = toast.loading(`Preparing ${plural(data.scope.calls, 'conversation')}…`)
          try {
            await exportCalls(scope, `aftercall-conversations-${stamp}.csv`)
          } finally {
            toast.dismiss(id)
          }
        })}>
          <Table aria-hidden />
          <span className="flex flex-col"><span className="flex items-center gap-1.5">Conversations as CSV {!bulk && <ProBadge />}</span><span className="text-xs text-muted-foreground">{plural(data.scope.calls, 'conversation')} with every answer</span></span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run('Image', async () => { if (page.current) await savePng(page.current, `${fileSlug('aftercall insights')}-${stamp}.png`) })}>
          <FileImage aria-hidden /> Image (PNG)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTimeout(print, 50)}>
          <Printer aria-hidden /> Print or save as PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={run('Copy', async () => {
          await navigator.clipboard.writeText(location.href)
          toast.success('Link copied. It opens this view, filters and all.')
        })}>
          <LinkIcon aria-hidden /> Copy link to this view
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  )
}
