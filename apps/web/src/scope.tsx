// The Insights scope: a time range and filters that every number on the page follows. It lives
// in the URL, so a view can be shared as a link. Insights and dashboards both use it.
import { ArrowDown, ArrowUp, Faders, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Dimensions, InsightScope, SignalInsight, Tracker } from './api'
import { Button } from './components/ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { channelLabel, title } from './lib/format'
import { ease } from './lib/motion'
import { Segmented } from './ui'

export type Range = '7' | '30' | '90' | 'all'
export const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
]
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
export const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : undefined)

export function scopeOf(p: URLSearchParams): InsightScope {
  const range = (p.get('range') ?? '30') as Range
  const meta: Record<string, string[]> = {}
  p.forEach((v, k) => k.startsWith('meta.') && (meta[k.slice(5)] = list(v) ?? []))
  return {
    ...(range === 'all' ? {} : { from: day(Number(range) - 1), to: day(0) }),
    channel: list(p.get('channel')),
    agent_version: list(p.get('agent_version')),
    meta,
    where: p.getAll('where'),
    version: p.get('version') === 'current' ? 'current' : undefined,
  }
}

export function shiftBack(s: InsightScope): InsightScope | null {
  if (!s.from || !s.to) return null
  const len = (Date.parse(s.to) - Date.parse(s.from)) / 86_400_000 + 1
  const back = (d: string) => new Date(Date.parse(d) - len * 86_400_000).toISOString().slice(0, 10)
  return { ...s, from: back(s.from), to: back(s.to) }
}

/** "outcome.call_outcome:declined" → "Call outcome is Declined" */
export function whereLabel(w: string, trackers: Tracker[]) {
  const m = /^([^.]+)\.([^:]+):(.+)$/.exec(w)
  if (!m) return w
  const [, tr, sig, v] = m
  const s = trackers.find((t) => t.name === tr)?.signals.find((x) => x.name === sig)
  return `${title(sig)} is ${s ? valueLabel(s.spec.type, v, levelsOf(s.spec.criteria)) : title(v)}`
}

export const levelsOf = (criteria: unknown) =>
  Array.isArray(criteria) ? Object.fromEntries(criteria.map((t: string, i) => [String(i), t.split(':')[0].trim()])) : null

export function valueLabel(type: SignalInsight['type'], key: string, levels: Record<string, string> | null) {
  if (type === 'yes_no') return key === 'yes' ? 'Yes' : 'No'
  if (type === 'score') return levels?.[key] ? `${key} ${levels[key]}` : key
  return title(key)
}

export const VAGUE = new Set(['other', 'not_stated', 'not_applicable', 'unknown'])

export const rangeOf = (p: URLSearchParams) => (p.get('range') ?? '30') as Range
export const rangeLabel = (r: Range) => RANGES.find((x) => x.value === r)!.label

export function ScopeBar({ range, dims, params, trackers, update, extra }: {
  range: Range
  /** Shown at the end of the row, e.g. a dashboard's Save view. */
  extra?: ReactNode
  dims?: Dimensions
  params: URLSearchParams
  trackers: Tracker[]
  update: (fn: (p: URLSearchParams) => void) => void
}) {
  const toggle = (param: string, value: string) =>
    update((p) => {
      const cur = new Set(list(p.get(param)))
      if (cur.has(value)) cur.delete(value)
      else cur.add(value)
      if (cur.size) p.set(param, [...cur].join(','))
      else p.delete(param)
    })
  const has = (param: string, value: string) => (list(params.get(param)) ?? []).includes(value)

  const chips: { key: string; label: ReactNode; remove: () => void }[] = []
  for (const [param, name, fmt] of [['channel', 'Channel', channelLabel], ['agent_version', 'Agent version', (v: string) => v]] as const) {
    const vs = list(params.get(param))
    if (vs) chips.push({ key: param, label: <><span className="text-muted-foreground">{name}</span> {vs.map(fmt).join(', ')}</>, remove: () => update((p) => p.delete(param)) })
  }
  params.forEach((v, k) => {
    if (k.startsWith('meta.')) chips.push({ key: k, label: <><span className="text-muted-foreground">{title(k.slice(5))}</span> {v.split(',').join(', ')}</>, remove: () => update((p) => p.delete(k)) })
  })
  params.getAll('where').forEach((w) =>
    chips.push({ key: `w-${w}`, label: <><span className="text-muted-foreground">Where</span> {whereLabel(w, trackers)}</>, remove: () => update((p) => {
      const rest = p.getAll('where').filter((x) => x !== w)
      p.delete('where')
      rest.forEach((x) => p.append('where', x))
    }) }))
  if (params.get('version') === 'current') chips.push({ key: 'version', label: 'Current signal versions only', remove: () => update((p) => p.delete('version')) })

  return (
    <div className="sticky top-16 z-10 -mx-2 mb-2 rounded-xl bg-background/85 px-2 py-2 backdrop-blur-md md:top-0 print:static">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented id="ins-range" label="Time range" options={RANGES} value={range} onChange={(v) => update((p) => p.set('range', v))} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!dims}><Faders aria-hidden /> Filter</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {dims && dims.channels.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Channel</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {dims.channels.map((c) => (
                    <DropdownMenuCheckboxItem key={c} checked={has('channel', c)} onCheckedChange={() => toggle('channel', c)} onSelect={(e) => e.preventDefault()}>
                      {channelLabel(c)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {dims && dims.agents.some((a) => a.versions.length) && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Agent version</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {dims.agents.flatMap((a) => a.versions.map((v) => (
                    <DropdownMenuCheckboxItem key={`${a.agent_id}-${v}`} checked={has('agent_version', v)} onCheckedChange={() => toggle('agent_version', v)} onSelect={(e) => e.preventDefault()}>
                      {a.agent_id} <span className="text-muted-foreground">{v}</span>
                    </DropdownMenuCheckboxItem>
                  )))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {dims && Object.entries(dims.metadata).map(([k, vs]) => (
              <DropdownMenuSub key={k}>
                <DropdownMenuSubTrigger>{title(k)}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {vs.map((v) => (
                    <DropdownMenuCheckboxItem key={v} checked={has(`meta.${k}`, v)} onCheckedChange={() => toggle(`meta.${k}`, v)} onSelect={(e) => e.preventDefault()}>
                      {v}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={params.get('version') === 'current'}
              onCheckedChange={(on) => update((p) => (on ? p.set('version', 'current') : p.delete('version')))}
            >
              Current signal versions only
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {chips.length > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => update((p) => {
            for (const k of [...p.keys()]) if (k !== 'range') p.delete(k)
          })}>
            Clear filters
          </Button>
        )}
        {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
      </div>
      <AnimatePresence initial={false}>
        {chips.length > 0 && (
          <motion.ul
            className="flex flex-wrap gap-1.5 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, marginTop: 8 }}
            exit={{ height: 0, opacity: 0, marginTop: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease }}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {chips.map((c) => (
                <motion.li key={c.key} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease }}>
                  <span className="flex h-7 items-center gap-1 rounded-full border bg-card pr-1 pl-2.5 text-sm shadow-panel">
                    {c.label}
                    <button onClick={c.remove} className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Remove filter">
                      <X size={11} weight="bold" aria-hidden />
                    </button>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/** A change, neutral in colour: whether up is good depends on the signal. */
export function Delta({ value, unit, suffix }: { value: number; unit: string; suffix?: string }) {
  const r = unit === '%' ? Math.round(value) : Math.round(value * 10) / 10
  if (r === 0) return <span>No change{suffix ? ` ${suffix}` : ''}</span>
  const Icon = r > 0 ? ArrowUp : ArrowDown
  return (
    <span className="inline-flex items-center gap-0.5">
      <Icon size={11} weight="bold" aria-hidden />
      <span className="sr-only">{r > 0 ? 'up' : 'down'}</span>
      {Math.abs(r)}{unit}{suffix && <span className="ml-1">{suffix}</span>}
    </span>
  )
}
