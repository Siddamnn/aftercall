// The charts on an Insights card, shared with dashboards: a split bar for yes/no, ranked bars
// for pick one, columns for a score, and the table twin every chart has.
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import type { SignalInsight } from './api'
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip'
import { num, pct } from './lib/format'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { VAGUE, valueLabel } from './scope'

export interface Row { key: string; label: string; count: number; share: number; vague: boolean }

/** A signal's counts as rows, in the signal's own option order. */
export function rowsOf(s: Pick<SignalInsight, 'type' | 'levels'>, counts: Record<string, number>, n: number): Row[] {
  return Object.entries(counts).map(([key, count]) => ({
    key, count, share: n ? count / n : 0, label: valueLabel(s.type, key, s.levels), vague: s.type === 'choice' && VAGUE.has(key),
  }))
}

/** Hover and focus explain a mark; click opens its conversations; Alt-click filters the page to it. */
export function Mark({ r, n, onDrill, onFilter, className, children, style }: {
  r: Row
  n: number
  onDrill: (r: Row) => void
  onFilter?: (value: string) => void
  className?: string
  children?: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn('group/mark outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default', className)}
          style={style}
          disabled={r.count === 0}
          onClick={(e) => (e.altKey && onFilter ? onFilter(r.key) : onDrill(r))}
          aria-label={`${r.label}: ${num(r.count)} of ${num(n)}, ${pct(r.share)}. Open these conversations.`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-semibold">{r.label}</span> · {num(r.count)} of {num(n)} ({pct(r.share)})
        {r.count > 0 && <span className="block opacity-70">{onFilter ? 'Click to open · Alt-click to filter' : 'Click to open'}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export type ChartProps = { rows: Row[]; n: number; onDrill: (r: Row) => void; onFilter?: (value: string) => void }

/** Yes / No: one 100% bar, a 2px surface gap between the parts, and a legend. */
export function SplitBar({ rows, n, onDrill, onFilter }: ChartProps) {
  const parts = [rows.find((r) => r.key === 'yes')!, rows.find((r) => r.key === 'no')!]
  return (
    <div>
      <div className="flex h-3 gap-0.5">
        {parts.map((r, i) => r.share > 0 && (
          <Mark key={r.key} r={r} n={n} onDrill={onDrill} onFilter={onFilter} className="h-full min-w-1" style={{ flexGrow: r.share, flexBasis: 0 }}>
            <motion.span
              className={cn('block h-full transition-opacity group-hover/mark:opacity-80', i === 0 ? 'rounded-l-[4px] bg-primary' : 'rounded-r-[4px] bg-muted-foreground/25', parts[1 - i].share === 0 && 'rounded-[4px]')}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              style={{ originX: i === 0 ? 0 : 1 }}
              transition={{ duration: 0.5, ease }}
            />
          </Mark>
        ))}
      </div>
      <ul className="mt-3 flex gap-4 text-sm">
        {parts.map((r, i) => (
          <li key={r.key} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-[3px]', i === 0 ? 'bg-primary' : 'bg-muted-foreground/25')} aria-hidden />
            {r.label} <span className="text-muted-foreground tabular-nums">{pct(r.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Pick one: ranked bars, one colour; vague options are muted. The top 5, then the rest on demand. */
export function Bars({ rows, n, onDrill, onFilter }: ChartProps) {
  const [all, setAll] = useState(false)
  const sorted = [...rows].sort((a, b) => Number(a.vague) - Number(b.vague) || b.count - a.count)
  const shown = all ? sorted : sorted.slice(0, 5)
  const max = Math.max(...rows.map((r) => r.share), 0.0001)
  return (
    <div>
      <ul className="space-y-1">
        {shown.map((r) => (
          <li key={r.key}>
            <Mark r={r} n={n} onDrill={onDrill} onFilter={onFilter} className="grid w-full grid-cols-[minmax(0,7.5rem)_1fr_2.75rem] items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/70">
              <span className={cn('truncate text-sm', r.vague && 'text-muted-foreground')}>{r.label}</span>
              <span className="h-2 overflow-hidden">
                <motion.span
                  className={cn('block h-full rounded-r-[4px]', r.vague ? 'bg-muted-foreground/30' : 'bg-primary')}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max((r.share / max) * 100, r.count ? 1.5 : 0)}%` }}
                  transition={{ duration: 0.5, ease }}
                />
              </span>
              <span className="text-right text-sm tabular-nums text-ink-2">{pct(r.share)}</span>
            </Mark>
          </li>
        ))}
      </ul>
      {sorted.length > 5 && (
        <button onClick={() => setAll((a) => !a)} className="mt-1 px-1 text-xs font-medium text-primary hover:underline">
          {all ? 'Show fewer' : `+${sorted.length - 5} more`}
        </button>
      )}
    </div>
  )
}

/** Score: a column per level, in level order, one colour. */
export function Columns({ rows, n, onDrill, onFilter }: ChartProps) {
  const max = Math.max(...rows.map((r) => r.share), 0.0001)
  return (
    <div className="flex h-36 items-stretch gap-1.5 border-b">
      {rows.map((r) => (
        <Mark key={r.key} r={r} n={n} onDrill={onDrill} onFilter={onFilter} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-t-md pt-1 transition-colors hover:bg-muted/70">
          <span className="text-xs tabular-nums text-ink-2">{pct(r.share)}</span>
          <span className="flex h-20 w-full items-end justify-center">
            <motion.span
              className="block w-full max-w-6 rounded-t-[4px] bg-primary"
              initial={{ height: 0 }}
              animate={{ height: `${Math.max((r.share / max) * 100, r.count ? 3 : 0)}%` }}
              transition={{ duration: 0.5, ease }}
            />
          </span>
          <span className="w-full truncate pb-1 text-center text-[0.6875rem] text-muted-foreground" title={r.label}>{r.label.replace(/^\d+ /, '')}</span>
        </Mark>
      ))}
    </div>
  )
}

/** Every chart has a table twin. */
export function DataTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="pb-1.5 font-medium">Answer</th>
          <th scope="col" className="pb-1.5 text-right font-medium">Conversations</th>
          <th scope="col" className="pb-1.5 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => (
          <tr key={r.key} className="border-t">
            <th scope="row" className="py-1.5 text-left font-normal">{r.label}</th>
            <td className="py-1.5 text-right">{num(r.count)}</td>
            <td className="py-1.5 text-right text-ink-2">{pct(r.share)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
