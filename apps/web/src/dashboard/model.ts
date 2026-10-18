// What a dashboard chart can be, which charts fit which data, their names, and the charts and
// dashboards we suggest from the user's own trackers. Pure: no React.
import {
  ChartBar, ChartBarHorizontal, ChartDonut, ChartLine, GridFour, Gauge, Hash, Rows, Stack, Table,
} from '@phosphor-icons/react'
import type { ChartKind, Dimensions, SignalType, Tracker, Widget } from '../api'
import { channelLabel, title } from '../lib/format'
import { levelsOf, VAGUE, valueLabel } from '../scope'

export type Source = 'insights' | 'series' | 'breakdown'

export const KINDS: Record<ChartKind, { label: string; hint: string; Icon: typeof Hash; source: Source; size: Widget['size'] }> = {
  kpi: { label: 'Number', hint: 'One number and its change', Icon: Hash, source: 'insights', size: 1 },
  bar: { label: 'Bars', hint: 'Answers, largest first', Icon: ChartBarHorizontal, source: 'insights', size: 1 },
  column: { label: 'Columns', hint: 'Answers side by side', Icon: ChartBar, source: 'insights', size: 1 },
  donut: { label: 'Donut', hint: 'Each answer as a share of the whole', Icon: ChartDonut, source: 'insights', size: 1 },
  line: { label: 'Trend', hint: 'One answer over time', Icon: ChartLine, source: 'series', size: 2 },
  stacked: { label: 'Mix over time', hint: 'Every answer, period by period', Icon: Stack, source: 'series', size: 2 },
  compare: { label: 'Compare', hint: 'Split by channel, agent, rep…', Icon: Rows, source: 'breakdown', size: 2 },
  heatmap: { label: 'Heatmap', hint: 'Cross two things', Icon: GridFour, source: 'breakdown', size: 2 },
  table: { label: 'Table', hint: 'The exact numbers', Icon: Table, source: 'insights', size: 1 },
  confidence: { label: 'Confidence', hint: 'How sure the answers are', Icon: Gauge, source: 'insights', size: 1 },
}
export const KIND_ORDER: ChartKind[] = ['kpi', 'bar', 'column', 'donut', 'line', 'stacked', 'compare', 'heatmap', 'table', 'confidence']

export const CONVERSATIONS = 'conversations'

/** What the UI knows about a signal from its definition, for picking charts before any data. */
export interface SignalMeta {
  ref: string
  tracker: string
  name: string
  type: SignalType
  /** Every value it can give, in its own order: option keys, yes/no, or score levels. */
  keys: string[]
  levels: Record<string, string> | null
  gated: boolean
}

export function signalMeta(trackers: Tracker[], ref: string): SignalMeta | undefined {
  const [tr, name] = ref.split('.')
  const t = trackers.find((x) => x.name === tr)
  const s = t?.signals.find((x) => x.name === name)
  if (!t || !s) return undefined
  const type = s.spec.type
  const levels = type === 'score' ? levelsOf(s.spec.criteria) : null
  const keys = type === 'yes_no' ? ['yes', 'no'] : type === 'score' ? Object.keys(levels ?? {}) : Object.keys((s.spec.criteria as Record<string, string>) ?? {})
  return { ref, tracker: tr, name, type, keys, levels, gated: !!t.run_if }
}

export function activeSignals(trackers: Tracker[]): SignalMeta[] {
  return trackers.filter((t) => t.active).flatMap((t) => t.signals.filter((s) => s.active).map((s) => signalMeta(trackers, `${t.name}.${s.name}`)!))
}

export const labelOf = (m: SignalMeta, key: string) => valueLabel(m.type, key, m.levels)

/** Whether a chart fits: null when it does, else the reason it doesn't. */
export function unfit(kind: ChartKind, m: SignalMeta | undefined): string | null {
  if (!m) return ['kpi', 'line', 'compare'].includes(kind) ? null : 'Pick a signal to use this chart'
  if (kind === 'donut' && m.type === 'yes_no') return 'Two slices read better as one number'
  if (kind === 'donut' && m.keys.length > 6) return 'Too many answers for a donut; bars read better'
  return null
}

export const recommended = (m: SignalMeta | undefined): ChartKind => (!m ? 'kpi' : m.type === 'yes_no' ? 'kpi' : m.type === 'score' ? 'column' : 'bar')

/** The answer a number or trend follows when the user hasn't picked one. */
export function defaultValue(m: SignalMeta | undefined): string | undefined {
  if (!m || m.type === 'score') return undefined
  if (m.type === 'yes_no') return 'yes'
  return m.keys.find((k) => !VAGUE.has(k)) ?? m.keys[0]
}

/** The things a chart can be split by: dimensions from B6, then every other signal. */
export function splitOptions(dims: Dimensions | undefined, signals: SignalMeta[], metric: string) {
  const out: { value: string; label: string; group: 'Conversation' | 'Signals' }[] = []
  if (dims?.channels.length) out.push({ value: 'channel', label: 'Channel', group: 'Conversation' })
  if (dims?.agents.length) out.push({ value: 'agent_id', label: 'Agent', group: 'Conversation' })
  if (dims?.agents.some((a) => a.versions.length)) out.push({ value: 'agent_version', label: 'Agent version', group: 'Conversation' })
  for (const k of Object.keys(dims?.metadata ?? {})) out.push({ value: `meta.${k}`, label: title(k), group: 'Conversation' })
  for (const s of signals) if (s.ref !== metric && s.type !== 'score') out.push({ value: s.ref, label: title(s.name), group: 'Signals' })
  return out
}

export function byLabel(by: string) {
  if (by === 'channel') return 'channel'
  if (by === 'agent_id') return 'agent'
  if (by === 'agent_version') return 'agent version'
  if (by.startsWith('meta.')) return title(by.slice(5)).toLowerCase()
  return title(by.split('.')[1] ?? by).toLowerCase()
}

/** A group's label in a compare or heatmap: a channel, an answer to another signal, or as is. */
export function groupLabel(by: string, key: string, trackers: Tracker[]) {
  if (by === 'channel') return channelLabel(key)
  if (by.includes('.') && !by.startsWith('meta.')) {
    const m = signalMeta(trackers, by)
    return m ? labelOf(m, key) : key
  }
  return key
}

/** The name a chart gets unless the user types one. */
export function autoTitle(w: Pick<Widget, 'kind' | 'metric' | 'value' | 'by'>, trackers: Tracker[]): string {
  const m = signalMeta(trackers, w.metric)
  const name = m ? title(m.name) : w.metric === CONVERSATIONS ? 'Conversations' : title(w.metric.split('.')[1] ?? w.metric)
  const v = m && w.value && m.type === 'choice' ? labelOf(m, w.value) : null
  switch (w.kind) {
    case 'kpi':
      return m?.type === 'score' ? `${name}, on average` : v ? `${name}: ${v}` : name
    case 'line':
      return !m ? 'Conversations over time' : m.type === 'score' ? `${name} over time` : v ? `${name}: ${v}, over time` : `${name} over time`
    case 'stacked':
      return `${name} over time`
    case 'compare':
    case 'heatmap':
      return w.by ? `${name} by ${byLabel(w.by)}` : name
    case 'confidence':
      return `How sure: ${name.toLowerCase()}`
    default:
      return name
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10)
export const widgetKey = (w: Pick<Widget, 'kind' | 'metric' | 'value' | 'by'>) => [w.kind, w.metric, w.value ?? '', w.by ?? ''].join('|')

export function makeWidget(kind: ChartKind, metric: string, trackers: Tracker[], extra: Partial<Widget> = {}): Widget {
  const m = signalMeta(trackers, metric)
  return {
    id: newId(),
    kind,
    metric,
    size: KINDS[kind].size,
    ...(['kpi', 'line'].includes(kind) && defaultValue(m) ? { value: defaultValue(m) } : {}),
    ...extra,
  }
}

// ── Suggestions ────────────────────────────────────────────────────────────────

export interface Suggestion { widget: Widget; why: string }

/** Charts worth adding, from the user's own signals and data, best first; ones already there are left out. */
export function suggestions(trackers: Tracker[], dims: Dimensions | undefined, existing: Widget[] = []): Suggestion[] {
  const signals = activeSignals(trackers)
  const yesNo = signals.filter((s) => s.type === 'yes_no')
  const choice = signals.filter((s) => s.type === 'choice')
  const score = signals.filter((s) => s.type === 'score')
  const gate = choice.find((s) => !s.gated) // an ungated pick-one splits every conversation
  const versions = dims?.agents.some((a) => a.versions.length > 1)
  const people = Object.entries(dims?.metadata ?? {}).find(([, vs]) => vs.length > 1)?.[0]
  const w = (kind: ChartKind, metric: string, extra: Partial<Widget> = {}) => makeWidget(kind, metric, trackers, extra)
  const t = (s: SignalMeta) => title(s.name).toLowerCase()

  const out: Suggestion[] = [
    { widget: w('kpi', CONVERSATIONS), why: 'How many came in, and the change on the previous period' },
    ...yesNo.slice(0, 2).map((s) => ({ widget: w('kpi', s.ref), why: `How often ${t(s)}, at a glance` })),
    ...choice.slice(0, 2).map((s) => ({ widget: w('bar', s.ref), why: 'Which answers lead' })),
    ...score.slice(0, 1).map((s) => ({ widget: w('column', s.ref), why: `How ${t(s)} spreads across its levels` })),
    ...yesNo.slice(0, 1).map((s) => ({ widget: w('line', s.ref), why: 'Spot a jump after an agent or prompt change' })),
    ...(versions ? [...yesNo, ...choice].slice(0, 2).map((s) => ({ widget: w('compare', s.ref, { by: 'agent_version' }), why: 'Did the new agent version change it?' })) : []),
    ...(gate ? score.slice(0, 1).map((s) => ({ widget: w('heatmap', s.ref, { by: gate.ref }), why: `Where ${t(s)} runs high` })) : []),
    ...(gate ? yesNo.slice(0, 1).map((s) => ({ widget: w('heatmap', s.ref, { by: gate.ref }), why: `Which ${t(gate)} goes with ${t(s)}` })) : []),
    ...((dims?.channels.length ?? 0) > 1 ? [
      { widget: w('compare', CONVERSATIONS, { by: 'channel' }), why: 'Volume by channel' },
      ...choice.slice(0, 1).map((s) => ({ widget: w('compare', s.ref, { by: 'channel' }), why: 'Calls against chats' })),
    ] : []),
    ...(people ? choice.slice(0, 1).map((s) => ({ widget: w('compare', s.ref, { by: `meta.${people}` }), why: `Each ${title(people).toLowerCase()} side by side` })) : []),
    ...choice.slice(0, 1).map((s) => ({ widget: w('stacked', s.ref), why: 'How the mix shifts over time' })),
    { widget: w('line', CONVERSATIONS), why: 'Volume over time' },
    ...choice.filter((s) => s.keys.length <= 6).slice(0, 1).map((s) => ({ widget: w('donut', s.ref), why: 'Each answer as a share of the whole' })),
    ...signals.slice(0, 1).map((s) => ({ widget: w('confidence', s.ref), why: 'How many answers need a person to check' })),
  ]
  const have = new Set(existing.map(widgetKey))
  const seen = new Set<string>()
  return out.filter((s) => {
    const k = widgetKey(s.widget)
    if (have.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ── Templates for a new dashboard ──────────────────────────────────────────────

export interface Template { id: string; name: string; description: string; widgets: Widget[] }

export function templates(trackers: Tracker[], dims: Dimensions | undefined): Template[] {
  const signals = activeSignals(trackers)
  const w = (kind: ChartKind, metric: string, extra: Partial<Widget> = {}) => makeWidget(kind, metric, trackers, extra)
  const tops = signals.filter((s) => s.type !== 'score' && !s.gated)
  const out: Template[] = [{ id: 'blank', name: 'Blank', description: 'Start empty and add charts yourself.', widgets: [] }]
  if (!signals.length) return out

  // Overview: the suggestions, three numbers first, then the charts.
  const sug = suggestions(trackers, dims).map((s) => s.widget)
  const kpis = sug.filter((x) => x.kind === 'kpi').slice(0, 3)
  const charts = sug.filter((x) => x.kind !== 'kpi' && x.kind !== 'confidence').slice(0, 5)
  out.push({ id: 'overview', name: 'Overview', description: 'The headline numbers, then a chart for each tracker.', widgets: [...kpis, ...charts] })

  if (dims?.agents.some((a) => a.versions.length > 1)) {
    out.push({
      id: 'agents', name: 'Agent versions', description: 'Every signal split by agent version, to check a release.',
      widgets: [
        ...signals.filter((s) => s.type === 'yes_no').slice(0, 1).map((s) => w('line', s.ref, { size: 3 })),
        ...signals.slice(0, 6).map((s) => w('compare', s.ref, { by: 'agent_version', size: 1 })),
      ],
    })
  }
  if ((dims?.channels.length ?? 0) > 1) {
    out.push({
      id: 'channels', name: 'Channels', description: 'Calls and chats side by side.',
      widgets: [w('compare', CONVERSATIONS, { by: 'channel', size: 1 }), ...tops.slice(0, 5).map((s) => w('compare', s.ref, { by: 'channel', size: 1 }))],
    })
  }
  const people = Object.entries(dims?.metadata ?? {}).find(([, vs]) => vs.length > 1)?.[0]
  if (people) {
    out.push({
      id: 'people', name: `By ${title(people).toLowerCase()}`, description: `A row for each ${title(people).toLowerCase()}, for coaching.`,
      widgets: signals.slice(0, 6).map((s) => w(s.type === 'score' ? 'heatmap' : 'compare', s.ref, { by: `meta.${people}`, size: s.type === 'score' ? 3 : 1 })),
    })
  }
  return out
}
