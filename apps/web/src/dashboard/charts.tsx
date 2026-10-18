// Every dashboard chart: its data (one shared /insights/signals call, plus /insights/series or
// /insights/breakdown per chart), the chart itself, and the table twin that CSV export reuses.
import type { Format } from '@number-flow/react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import {
  getBreakdown, getSeries, USING_MOCK,
  type Breakdown, type Bucket, type Insights, type InsightScope, type Series, type SignalInsight, type Tracker, type Widget,
} from '../api'
import { ChartContainer } from '../components/ui/chart'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import type { Drill } from '../drill-down'
import type { Cell as CsvCell } from '../lib/export'
import { num, pct, plural, title } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Delta, VAGUE, type Range } from '../scope'
import { Bars, Columns, rowsOf, SplitBar, type Row } from '../signal-charts'
import { ErrorNote, Mono, Num } from '../ui'
import { byLabel, CONVERSATIONS, groupLabel, KINDS, labelOf, signalMeta, type SignalMeta } from './model'
import { ChartLoader } from '../loaders'

/** What every chart on a dashboard shares: the scope, and the one /insights/signals answer. */
export interface DashCtx {
  scope: InsightScope
  insights?: Insights
  prev?: Insights
  trackers: Tracker[]
  range: Range
  onDrill: (d: Drill) => void
}

export const autoBucket = (r: Range): Bucket => (r === '7' || r === '30' ? 'day' : 'week')

/** Recharts replays its entrance on every resize, and printing resizes the page, so a printed
 *  chart could come out mid-animation. Animate on first appearance only. */
function useEntrance() {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 800)
    return () => clearTimeout(t)
  }, [])
  return on
}

// ── Colour: follows the answer, never its rank ─────────────────────────────────

const GRAY = 'color-mix(in oklab, var(--muted-foreground) 35%, var(--card))'

/** Yes is cobalt and No gray (the story is the yes rate); score levels are one ordered ramp;
 *  pick-one options take the categorical slots in their defined order, vague ones gray. */
export function colorOf(m: SignalMeta | undefined, key: string): string {
  if (!m) return 'var(--series-1)'
  if (m.type === 'yes_no') return key === 'yes' ? 'var(--series-1)' : GRAY
  if (m.type === 'score') {
    const i = Number(key)
    return `color-mix(in oklab, var(--series-1) ${Math.round(40 + 60 * (i / Math.max(1, m.keys.length - 1)))}%, var(--card))`
  }
  if (VAGUE.has(key)) return GRAY
  const i = m.keys.filter((k) => !VAGUE.has(k)).indexOf(key)
  return i >= 0 && i < 8 ? `var(--series-${i + 1})` : GRAY
}

// ── Data ───────────────────────────────────────────────────────────────────────

export interface WidgetData {
  meta?: SignalMeta
  s?: SignalInsight
  prevS?: SignalInsight
  series?: Series
  breakdown?: Breakdown
  ready: boolean
  error?: string
  reload: () => void
  /** The signal was deleted or turned off since the chart was made. */
  missing: boolean
}

export function useWidgetData(w: Widget, ctx: DashCtx): WidgetData {
  const source = KINDS[w.kind].source
  const bucket = w.bucket ?? autoBucket(ctx.range)
  const signal = w.metric === CONVERSATIONS ? undefined : w.metric
  const meta = signal ? signalMeta(ctx.trackers, signal) : undefined
  const missing = !!signal && ctx.trackers.length > 0 && !meta
  const wantSeries = !missing && (source === 'series' || w.kind === 'kpi')
  const wantBreakdown = !missing && source === 'breakdown' && !!w.by
  const key = JSON.stringify([ctx.scope, w.kind, w.metric, w.by, bucket, wantSeries, wantBreakdown])
  const series = useLoad(() => (wantSeries ? getSeries(ctx.scope, { signal, bucket }) : Promise.resolve(undefined)), [key])
  const breakdown = useLoad(() => (wantBreakdown ? getBreakdown(ctx.scope, { signal, by: w.by! }) : Promise.resolve(undefined)), [key])
  const find = (d?: Insights) => d?.signals.find((x) => `${x.tracker}.${x.signal}` === signal)
  const ready = source === 'series' ? !!series.data : source === 'breakdown' ? !!breakdown.data : !!ctx.insights
  const error = source === 'series' ? series.error : source === 'breakdown' ? breakdown.error : undefined
  return {
    meta, s: find(ctx.insights), prevS: find(ctx.prev), series: series.data, breakdown: breakdown.data,
    ready, error, missing, reload: source === 'series' ? series.reload : breakdown.reload,
  }
}

// ── Drill-down scopes ──────────────────────────────────────────────────────────

const where = (scope: InsightScope, w: string): InsightScope => ({ ...scope, where: [...(scope.where ?? []), w] })

function withGroup(scope: InsightScope, by: string, g: string): InsightScope {
  if (by === 'channel' || by === 'agent_id' || by === 'agent_version') return { ...scope, [by]: [g] }
  if (by.startsWith('meta.')) return { ...scope, meta: { ...scope.meta, [by.slice(5)]: [g] } }
  return where(scope, `${by}:${g}`)
}

const dayShort = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function bucketEnd(start: string, bucket: Bucket, scopeTo?: string) {
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + (bucket === 'week' ? 6 : 0) * 86_400_000).toISOString().slice(0, 10)
  return scopeTo && scopeTo < end ? scopeTo : end
}

// ── The table twin: what the table view shows and what CSV export writes ───────

export interface TableData { head: string[]; rows: CsvCell[][] }

export function tableOf(w: Widget, d: WidgetData, ctx: DashCtx): TableData | null {
  const m = d.meta
  const share = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : '')
  if (w.kind === 'confidence' && d.s) {
    return {
      head: ['Confidence', 'Answers'],
      rows: d.s.confidence.bins.map((n, i) => [`${i * 10}–${i * 10 + 10}%`, n]),
    }
  }
  if (KINDS[w.kind].source === 'insights') {
    if (!m) return ctx.insights ? { head: ['Conversations', 'Previous period'], rows: [[ctx.insights.scope.calls, ctx.insights.scope.calls_previous]] } : null
    if (!d.s) return null
    return {
      head: ['Answer', 'Conversations', 'Share %'],
      rows: m.keys.map((k) => [labelOf(m, k), d.s!.counts[k] ?? 0, share(d.s!.counts[k] ?? 0, d.s!.answered)]),
    }
  }
  if (d.series) {
    const pts = d.series.points
    if (!m) return { head: ['Period start', 'Conversations'], rows: pts.map((p) => [p.start, p.calls]) }
    if (w.kind === 'line') {
      return m.type === 'score'
        ? { head: ['Period start', 'Answers', 'Average'], rows: pts.map((p) => [p.start, p.answered, p.mean === null ? '' : Math.round(p.mean * 100) / 100]) }
        : { head: ['Period start', 'Answers', `${labelOf(m, w.value ?? 'yes')} %`], rows: pts.map((p) => [p.start, p.answered, share(p.counts[w.value ?? 'yes'] ?? 0, p.answered)]) }
    }
    return { head: ['Period start', 'Answers', ...m.keys.map((k) => `${labelOf(m, k)} %`)], rows: pts.map((p) => [p.start, p.answered, ...m.keys.map((k) => share(p.counts[k] ?? 0, p.answered))]) }
  }
  if (d.breakdown && w.by) {
    const g = d.breakdown.groups
    const by = title(byLabel(w.by))
    if (!m) return { head: [by, 'Conversations'], rows: g.map((x) => [groupLabel(w.by!, x.key, ctx.trackers), x.answered]) }
    return {
      head: [by, 'Answers', ...m.keys.map((k) => `${labelOf(m, k)} %`), ...(m.type === 'score' ? ['Average'] : [])],
      rows: g.map((x) => [
        groupLabel(w.by!, x.key, ctx.trackers), x.answered, ...m.keys.map((k) => share(x.counts[k] ?? 0, x.answered)),
        ...(m.type === 'score' ? [x.mean === null ? '' : Math.round(x.mean * 100) / 100] : []),
      ]),
    }
  }
  return null
}

export function TableView({ t }: { t: TableData }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-xs text-muted-foreground">
            {t.head.map((h, i) => <th key={h} scope="col" className={cn('pb-1.5 font-medium whitespace-nowrap', i > 0 && 'pl-3 text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {t.rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => j === 0
                ? <th key={j} scope="row" className="py-1.5 text-left font-normal whitespace-nowrap">{String(c ?? '')}</th>
                : <td key={j} className="py-1.5 pl-3 text-right text-ink-2">{typeof c === 'number' ? num(c) : String(c ?? '–')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── The chart for a widget ─────────────────────────────────────────────────────

const HEIGHT: Record<Widget['kind'], string> = {
  kpi: 'h-28', bar: 'h-44', column: 'h-40', donut: 'h-44', line: 'h-52', stacked: 'h-52', compare: 'h-48', heatmap: 'h-48', table: 'h-44', confidence: 'h-40',
}

export function WidgetBody({ w, d, ctx, asTable }: { w: Widget; d: WidgetData; ctx: DashCtx; asTable?: boolean }) {
  if (d.missing) {
    return <Quiet>This signal was deleted or turned off. Edit the chart to pick another.</Quiet>
  }
  if (d.error) {
    const need = KINDS[w.kind].source === 'series' ? 'B8' : 'B9'
    return (
      <ErrorNote onRetry={d.reload} className="p-3 text-xs">
        {USING_MOCK ? d.error : <>This chart needs the backend's <Mono>/insights/{need === 'B8' ? 'series' : 'breakdown'}</Mono> (request {need}). <span className="text-muted-foreground">({d.error})</span></>}
      </ErrorNote>
    )
  }
  // The chart's own shape while its numbers load (loaders.tsx): a number, a line, or bars.
  if (!d.ready) return <ChartLoader kind={w.kind === 'kpi' ? 'number' : w.kind === 'line' || w.kind === 'stacked' ? 'line' : 'bar'} className={cn('w-full', HEIGHT[w.kind])} />
  if (asTable || w.kind === 'table') {
    const t = tableOf(w, d, ctx)
    return t ? <TableView t={t} /> : <Quiet>No answers in this view.</Quiet>
  }
  const m = d.meta
  switch (w.kind) {
    case 'kpi': return <KpiView w={w} d={d} ctx={ctx} />
    case 'line': return <LineView w={w} d={d} ctx={ctx} />
    case 'stacked': return <StackedView d={d} ctx={ctx} />
    case 'compare': return <CompareView w={w} d={d} ctx={ctx} />
    case 'heatmap': return <HeatmapView w={w} d={d} ctx={ctx} />
    case 'confidence': return d.s ? <ConfidenceView s={d.s} /> : <Quiet>No answers in this view.</Quiet>
  }
  if (!m || !d.s) return <Quiet>No answers in this view.</Quiet>
  if (!d.s.answered) return <Quiet>No answers in this view.</Quiet>
  const s = d.s
  const rows = rowsOf(s, Object.fromEntries(m.keys.map((k) => [k, s.counts[k] ?? 0])), s.answered)
  const drill = (r: Row) => ctx.onDrill({ label: `${title(m.name)} is ${r.label}`, scope: where(ctx.scope, `${m.ref}:${r.key}`), signal: m.ref })
  if (w.kind === 'donut') return <DonutView m={m} rows={rows} n={s.answered} onDrill={drill} />
  if (w.kind === 'column' || m.type === 'score') return <Columns rows={rows} n={s.answered} onDrill={drill} />
  if (m.type === 'yes_no') return <SplitBar rows={rows} n={s.answered} onDrill={drill} />
  return <Bars rows={rows} n={s.answered} onDrill={drill} />
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="grid min-h-24 place-items-center rounded-lg bg-muted/50 px-4 text-center text-sm text-muted-foreground">{children}</p>
}

// ── Number ─────────────────────────────────────────────────────────────────────

function KpiView({ w, d, ctx }: { w: Widget; d: WidgetData; ctx: DashCtx }) {
  const m = d.meta
  const pts = d.series?.points ?? []
  let value: number, format: Format, sub: string, delta: ReactNode = null, spark: (number | null)[], n: number
  if (!m) {
    const cur = ctx.insights!.scope
    value = cur.calls
    format = {}
    sub = 'conversations'
    n = cur.calls
    if (cur.calls_previous) delta = <Delta value={((cur.calls - cur.calls_previous) / cur.calls_previous) * 100} unit="%" />
    spark = pts.map((p) => p.calls)
  } else if (!d.s || !d.s.answered) {
    return <Quiet>No answers in this view.</Quiet>
  } else if (m.type === 'score') {
    value = d.s.mean ?? 0
    format = { maximumFractionDigits: 1, minimumFractionDigits: 1 }
    sub = `average · ${m.levels?.[String(Math.round(value))] ?? ''}`
    n = d.s.answered
    if (d.prevS?.mean != null && d.prevS.answered >= 30 && n >= 30) delta = <Delta value={value - d.prevS.mean} unit="" />
    spark = pts.map((p) => (p.answered ? p.mean : null))
  } else {
    const k = w.value ?? 'yes'
    value = (d.s.counts[k] ?? 0) / d.s.answered
    format = { style: 'percent', maximumFractionDigits: 0 }
    sub = m.type === 'yes_no' ? (k === 'yes' ? 'said yes' : 'said no') : `were ${labelOf(m, k).toLowerCase()}`
    n = d.s.answered
    if (d.prevS && d.prevS.answered >= 30 && n >= 30) delta = <Delta value={(value - (d.prevS.counts[k] ?? 0) / d.prevS.answered) * 100} unit=" pts" />
    spark = pts.map((p) => (p.answered ? (p.counts[k] ?? 0) / p.answered : null))
  }
  const drillable = m && m.type !== 'score'
  const big = <Num value={value} format={format} className="text-4xl font-semibold tracking-[-0.03em] [font-variant-numeric:normal]" />
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div>
        <div className="flex items-baseline gap-2">
          {drillable ? (
            <button
              className="rounded-md outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => ctx.onDrill({ label: `${title(m.name)} is ${labelOf(m, w.value ?? 'yes')}`, scope: where(ctx.scope, `${m.ref}:${w.value ?? 'yes'}`), signal: m.ref })}
              title="Open these conversations"
            >
              {big}
            </button>
          ) : big}
          <span className="min-w-0 truncate text-sm text-ink-2">{sub}</span>
        </div>
        <p className="mt-0.5 h-4 text-xs text-muted-foreground">
          {ctx.range === 'all' ? plural(n, m ? 'answer' : 'conversation') : m && n < 30 ? 'Too few to compare' : delta ? <>{delta} vs previous period</> : plural(n, m ? 'answer' : 'conversation')}
        </p>
      </div>
      <Sparkline values={spark} />
    </div>
  )
}

/** A 2px trend line with a faint area, no axes: the shape, not the values. */
function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null)
  if (pts.length < 2) return <div className="h-10" />
  const max = Math.max(...pts.map((p) => p[1]))
  const min = Math.min(...pts.map((p) => p[1]))
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * 100
  const y = (v: number) => 30 - ((v - min) / (max - min || 1)) * 28
  const line = pts.map(([i, v], j) => `${j ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  return (
    // Revealed left to right with a clip: pathLength can't draw a non-scaling stroke.
    <motion.svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-10 w-full overflow-visible" aria-hidden
      initial={{ clipPath: 'inset(-2px 100% -2px 0)' }} animate={{ clipPath: 'inset(-2px 0% -2px 0)' }} transition={{ duration: 0.7, ease }}>
      <path d={`${line} L${x(pts[pts.length - 1][0])},32 L${x(pts[0][0])},32 Z`} fill="var(--series-1)" opacity={0.08} />
      <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </motion.svg>
  )
}

// ── Donut ──────────────────────────────────────────────────────────────────────

function DonutView({ m, rows, n, onDrill }: { m: SignalMeta; rows: Row[]; n: number; onDrill: (r: Row) => void }) {
  const top = [...rows].filter((r) => !r.vague).sort((a, b) => b.count - a.count)[0] ?? rows[0]
  const data = rows.filter((r) => r.count > 0)
  const animate = useEntrance()
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="relative size-40 shrink-0">
        <ChartContainer config={{}} className="aspect-square size-40">
          <PieChart>
            <RTooltip cursor={false} content={({ active, payload }) => active && payload?.[0] ? <Tip>{tipRow(payload[0].payload as Row, n)}</Tip> : null} />
            <Pie
              data={data} dataKey="count" nameKey="label" innerRadius="64%" outerRadius="100%" stroke="var(--card)" strokeWidth={2}
              startAngle={90} endAngle={-270} animationDuration={600} isAnimationActive={animate} className="cursor-pointer"
              onClick={(_, i) => onDrill(data[i])}
            >
              {data.map((r) => <Cell key={r.key} fill={colorOf(m, r.key)} />)}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xl font-semibold tracking-tight">{pct(top.share)}</div>
            <div className="max-w-20 truncate text-xs text-muted-foreground">{top.label}</div>
          </div>
        </div>
      </div>
      <Legend m={m} rows={rows} className="min-w-36 flex-1 flex-col gap-1" />
    </div>
  )
}

function Legend({ m, rows, className }: { m: SignalMeta; rows: Pick<Row, 'key' | 'label' | 'share'>[] | { key: string; label: string; share?: number }[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-3 gap-y-1 text-xs', className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex min-w-0 items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(m, r.key) }} aria-hidden />
          <span className="truncate text-ink-2">{r.label}</span>
          {r.share !== undefined && <span className="ml-auto pl-1 text-muted-foreground tabular-nums">{pct(r.share)}</span>}
        </li>
      ))}
    </ul>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-float">{children}</div>
}
const tipRow = (r: Row, n: number) => <><span className="font-semibold">{r.label}</span> · {num(r.count)} of {num(n)} ({pct(r.share)})<span className="block text-muted-foreground">Click to open</span></>

// ── Trend ──────────────────────────────────────────────────────────────────────

const axis = { tickLine: false, axisLine: false, fontSize: 11 } as const

function LineView({ w, d, ctx }: { w: Widget; d: WidgetData; ctx: DashCtx }) {
  const m = d.meta
  const series = d.series!
  const k = w.value ?? 'yes'
  const data = series.points.map((p) => ({
    start: p.start,
    n: m ? p.answered : p.calls,
    v: !m ? p.calls : m.type === 'score' ? p.mean : p.answered ? (p.counts[k] ?? 0) / p.answered : null,
  }))
  const isShare = !!m && m.type !== 'score'
  const fmt = (v: number) => (isShare ? pct(v) : m ? v.toFixed(1) : num(v))
  const events = series.events.map((e) => ({ ...e, x: [...data].reverse().find((p) => p.start <= e.at)?.start })).filter((e) => e.x)
  if (!data.some((p) => p.v !== null)) return <Quiet>No answers in this view.</Quiet>
  const label = !m ? 'Conversations' : m.type === 'score' ? 'Average' : labelOf(m, k)
  return <LineChartInner data={data} m={m} k={k} series={series} ctx={ctx} fmt={fmt} events={events} label={label} />
}

function LineChartInner({ data, m, k, series, ctx, fmt, events, label }: {
  data: { start: string; n: number; v: number | null }[]
  m?: SignalMeta
  k: string
  series: Series
  ctx: DashCtx
  fmt: (v: number) => string
  events: { at: string; kind: string; label: string; x?: string }[]
  label: string
}) {
  const animate = useEntrance()
  return (
    <ChartContainer config={{}} className="aspect-auto h-52 w-full">
      <AreaChart
        data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} className="cursor-pointer"
        onClick={(st) => {
          const start = st?.activeLabel as string | undefined
          if (!start) return
          const to = bucketEnd(start, series.bucket, ctx.scope.to)
          const scope = { ...ctx.scope, from: start, to }
          ctx.onDrill({
            label: `${m ? title(m.name) : 'Conversations'}, ${series.bucket === 'week' ? `week of ${dayShort(start)}` : dayShort(start)}`,
            scope: m && m.type !== 'score' ? where(scope, `${m.ref}:${k}`) : scope,
            signal: m?.ref,
          })
        }}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="start" {...axis} minTickGap={28} tickFormatter={dayShort} />
        <YAxis {...axis} width={40} tickFormatter={fmt} domain={m?.type === 'score' ? [0, m.keys.length - 1] : [0, 'auto']} allowDecimals={!!m} />
        {events.map((e) => (
          <ReferenceLine key={`${e.kind}-${e.label}`} x={e.x} stroke="var(--muted-foreground)" strokeOpacity={0.5}
            label={{ value: e.label, position: 'insideTopLeft', fontSize: 10, fill: 'var(--muted-foreground)', offset: 4 }} />
        ))}
        <RTooltip
          cursor={{ stroke: 'var(--border)' }}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined
            if (!active || !p) return null
            return (
              <Tip>
                <span className="block text-muted-foreground">{series.bucket === 'week' ? `Week of ${dayShort(p.start)}` : dayShort(p.start)}</span>
                <span className="font-semibold">{label}</span> {p.v === null ? '–' : fmt(p.v)}
                {m && <span className="text-muted-foreground"> · {plural(p.n, 'answer')}</span>}
              </Tip>
            )
          }}
        />
        <Area type="monotone" dataKey="v" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.08} connectNulls
          dot={false} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} animationDuration={600} isAnimationActive={animate} />
      </AreaChart>
    </ChartContainer>
  )
}

// ── Mix over time ──────────────────────────────────────────────────────────────

function StackedView({ d, ctx }: { d: WidgetData; ctx: DashCtx }) {
  const m = d.meta
  if (!m) return <Quiet>Pick a signal to see its mix over time.</Quiet>
  const series = d.series!
  const data = series.points.map((p) => ({ start: p.start, n: p.answered, ...Object.fromEntries(m.keys.map((k) => [k, p.counts[k] ?? 0])) }))
  if (!data.some((p) => p.n)) return <Quiet>No answers in this view.</Quiet>
  return <StackedInner data={data} m={m} series={series} ctx={ctx} />
}

function StackedInner({ data, m, series, ctx }: { data: ({ start: string; n: number } & Record<string, number | string>)[]; m: SignalMeta; series: Series; ctx: DashCtx }) {
  const animate = useEntrance()
  return (
    <div>
      <Legend m={m} rows={m.keys.map((k) => ({ key: k, label: labelOf(m, k) }))} className="mb-2" />
      <ChartContainer config={{}} className="aspect-auto h-44 w-full">
        <BarChart
          data={data} stackOffset="expand" margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={series.points.length > 20 ? 1 : 3}
          className="cursor-pointer"
          onClick={(st) => {
            const start = st?.activeLabel as string | undefined
            if (start) ctx.onDrill({ label: `${title(m.name)}, ${series.bucket === 'week' ? `week of ${dayShort(start)}` : dayShort(start)}`, scope: { ...ctx.scope, from: start, to: bucketEnd(start, series.bucket, ctx.scope.to) }, signal: m.ref })
          }}
        >
          <XAxis dataKey="start" {...axis} minTickGap={28} tickFormatter={dayShort} />
          <YAxis {...axis} width={40} tickFormatter={(v: number) => pct(v)} ticks={[0, 0.5, 1]} />
          <RTooltip
            cursor={{ fill: 'var(--muted)' }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Record<string, number> & { start: string; n: number } | undefined
              if (!active || !p) return null
              return (
                <Tip>
                  <span className="block text-muted-foreground">{series.bucket === 'week' ? `Week of ${dayShort(p.start)}` : dayShort(p.start)} · {plural(p.n, 'answer')}</span>
                  {[...m.keys].reverse().map((k) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px]" style={{ background: colorOf(m, k) }} />
                      {labelOf(m, k)} <span className="ml-auto pl-3 tabular-nums">{p.n ? pct((p[k] ?? 0) / p.n) : '–'}</span>
                    </span>
                  ))}
                </Tip>
              )
            }}
          />
          {m.keys.map((k) => <Bar key={k} dataKey={k} stackId="a" fill={colorOf(m, k)} stroke="var(--card)" strokeWidth={1} animationDuration={500} isAnimationActive={animate} />)}
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── Compare: a 100% bar per group ──────────────────────────────────────────────

function CompareView({ w, d, ctx }: { w: Widget; d: WidgetData; ctx: DashCtx }) {
  const m = d.meta
  const b = d.breakdown!
  const by = w.by!
  const groups = b.groups.filter((g) => g.answered > 0)
  if (!groups.length) return <Quiet>Nothing to compare in this view.</Quiet>
  const label = (k: string) => groupLabel(by, k, ctx.trackers)

  if (!m) {
    const max = Math.max(...groups.map((g) => g.answered))
    const total = groups.reduce((a, g) => a + g.answered, 0)
    return (
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.key}>
            <Hit tip={<><span className="font-semibold">{label(g.key)}</span> · {plural(g.answered, 'conversation')} ({pct(g.answered / total)})<span className="block text-muted-foreground">Click to open</span></>}
              onClick={() => ctx.onDrill({ label: `${title(byLabel(by))}: ${label(g.key)}`, scope: withGroup(ctx.scope, by, g.key) })}
              className="grid w-full grid-cols-[minmax(0,7.5rem)_1fr_3.5rem] items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/70">
              <span className="truncate text-sm">{label(g.key)}</span>
              <span className="h-2"><motion.span className="block h-full rounded-r-[4px] bg-primary" initial={{ width: 0 }} animate={{ width: `${(g.answered / max) * 100}%` }} transition={{ duration: 0.5, ease }} /></span>
              <span className="text-right text-sm tabular-nums text-ink-2">{num(g.answered)}</span>
            </Hit>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div>
      <Legend m={m} rows={m.keys.map((k) => ({ key: k, label: labelOf(m, k) }))} className="mb-3" />
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr_3.5rem] items-center gap-2">
            <span className="truncate text-sm" title={label(g.key)}>{label(g.key)}</span>
            <span className="flex h-3 gap-0.5">
              {m.keys.map((k, i) => {
                const n = g.counts[k] ?? 0
                if (!n) return null
                return (
                  <Hit key={k} style={{ flexGrow: n, flexBasis: 0 }} className="h-full min-w-0.5"
                    tip={<><span className="font-semibold">{label(g.key)}</span>: {labelOf(m, k)} · {num(n)} of {num(g.answered)} ({pct(n / g.answered)})<span className="block text-muted-foreground">Click to open</span></>}
                    onClick={() => ctx.onDrill({ label: `${title(m.name)} is ${labelOf(m, k)} · ${label(g.key)}`, scope: where(withGroup(ctx.scope, by, g.key), `${m.ref}:${k}`), signal: m.ref })}>
                    <motion.span className={cn('block h-full transition-opacity hover:opacity-80', i === 0 && 'rounded-l-[4px]', i === m.keys.length - 1 && 'rounded-r-[4px]')}
                      style={{ background: colorOf(m, k), originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease }} />
                  </Hit>
                )
              })}
            </span>
            <span className="text-right text-xs tabular-nums text-muted-foreground">{m.type === 'score' && g.mean !== null ? `avg ${g.mean.toFixed(1)}` : compactN(g.answered)}</span>
          </li>
        ))}
      </ul>
      {(b.missing > 0 || b.other.answered > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {[b.other.answered > 0 && `${num(b.other.answered)} more in smaller groups`, b.missing > 0 && `${num(b.missing)} with no ${byLabel(by)}`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}
const compactN = (n: number) => `n ${num(n)}`

/** A mark with a tooltip that opens its conversations; the hit area is the whole segment. */
function Hit({ tip, onClick, className, style, children }: { tip: ReactNode; onClick: () => void; className?: string; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={cn('outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60', className)} style={style} onClick={onClick}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

// ── Heatmap: share of each row, one hue ────────────────────────────────────────

function HeatmapView({ w, d, ctx }: { w: Widget; d: WidgetData; ctx: DashCtx }) {
  const m = d.meta
  if (!m) return <Quiet>Pick a signal to cross.</Quiet>
  const b = d.breakdown!
  const by = w.by!
  const groups = b.groups.filter((g) => g.answered > 0)
  if (!groups.length) return <Quiet>Nothing to cross in this view.</Quiet>
  const share = (g: (typeof groups)[number], k: string) => (g.counts[k] ?? 0) / g.answered
  const max = Math.max(...groups.flatMap((g) => m.keys.map((k) => share(g, k))), 0.0001)
  const label = (k: string) => groupLabel(by, k, ctx.trackers)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-md table-fixed border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th scope="col" className="w-36 pb-1 text-left font-medium text-muted-foreground">{title(byLabel(by))}</th>
            {m.keys.map((k) => <th key={k} scope="col" className="truncate px-1 pb-1 text-center font-medium text-muted-foreground" title={labelOf(m, k)}>{labelOf(m, k).replace(/^\d+ /, '')}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => (
            <tr key={g.key}>
              <th scope="row" className="truncate pr-2 text-left text-sm font-normal" title={label(g.key)}>
                {label(g.key)} <span className="text-xs text-muted-foreground tabular-nums">{compactN(g.answered)}</span>
              </th>
              {m.keys.map((k, ki) => {
                const v = share(g, k)
                const t = v / max
                return (
                  <td key={k} className="p-0">
                    <Hit
                      tip={<><span className="font-semibold">{pct(v)}</span> of {label(g.key)} ({num(g.answered)}) had {title(m.name).toLowerCase()} {labelOf(m, k)}<span className="block text-muted-foreground">Click to open</span></>}
                      onClick={() => ctx.onDrill({ label: `${title(m.name)} is ${labelOf(m, k)} · ${label(g.key)}`, scope: where(withGroup(ctx.scope, by, g.key), `${m.ref}:${k}`), signal: m.ref })}
                      className="block h-9 w-full rounded-[4px] hover:ring-2 hover:ring-foreground/20"
                    >
                      <motion.span
                        className={cn('grid h-full place-items-center rounded-[4px] tabular-nums', t > 0.55 ? 'text-primary-foreground' : 'text-foreground')}
                        style={{ background: v ? `color-mix(in oklab, var(--series-1) ${Math.round(8 + t * 82)}%, var(--card))` : 'var(--muted)' }}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease, delay: Math.min(gi * 0.03 + ki * 0.015, 0.4) }}
                      >
                        {v ? pct(v) : '–'}
                      </motion.span>
                    </Hit>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        Share of each row
        <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--series-1) 8%, var(--card)), var(--series-1))' }} aria-hidden />
        0–{pct(max)}
      </div>
    </div>
  )
}

// ── Confidence ─────────────────────────────────────────────────────────────────

function ConfidenceView({ s }: { s: SignalInsight }) {
  const { bins, threshold } = s.confidence
  const max = Math.max(...bins, 1)
  return (
    <div>
      <div className="relative flex h-28 items-end gap-0.5 border-b">
        {bins.map((n, i) => {
          const low = (i + 1) / 10 <= threshold + 1e-9
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                  <motion.span className={cn('block w-full rounded-t-[3px]', low ? 'bg-warn' : 'bg-primary')}
                    initial={{ height: 0 }} animate={{ height: `${Math.max((n / max) * 100, n ? 2 : 0)}%` }} transition={{ duration: 0.5, ease, delay: i * 0.02 }} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{i * 10}–{i * 10 + 10}% sure · {plural(n, 'answer')}</TooltipContent>
            </Tooltip>
          )
        })}
        <span className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${threshold * 100}%` }} aria-hidden />
      </div>
      <div className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground tabular-nums"><span>0%</span><span>50%</span><span>100% sure</span></div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-warn" aria-hidden />Needs review (under {pct(threshold)}) <span className="text-muted-foreground tabular-nums">{pct(s.needs_review / Math.max(1, s.answered))}</span></li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-primary" aria-hidden />Sure enough</li>
      </ul>
    </div>
  )
}
