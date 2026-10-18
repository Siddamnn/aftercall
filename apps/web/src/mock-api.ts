// In-memory mock of the backend, with the real endpoints' shapes and rules (conditions,
// dependency checks, import, overlap). Resets on reload.
// Used when VITE_API_MOCK=true (see api.ts), so the UI runs without the backend.
import sampleCalls from '../../../samples/calls_booking.json'
import sampleTrackers from '../../../samples/trackers_booking.json'
import {
  ApiError, TOKEN_BUDGET, estimateTokens,
  type Answer, type Answers, type CallResult, type Condition, type ConditionCheck, type Flagged, type ImportResult,
  type OnConflict, type Overlap, type Signal, type SignalSpec, type Tracker, type TrackerSpec, type UploadOut,
  type UploadStatus, type Usage, type UsageDay,
  type CallPage, type CallQuery, type Dimensions, type Insights, type InsightScope, type SignalInsight,
  type Account, type Project, type ProjectIn, type AlteriaAnswer, type AskThread, type AskThreadPage, type AskThreadPatch, type AskThreadSummary, type AutoTopUp, type BulkResult, type AppNotification, type AllowancePolicy, type AllowancePolicyIn, type Discount, type DisplayCurrency, type MembersUsage, type MemberUsage, type PricingConfig, type Promotion, type Quote, type NotificationPage, type Invite, type InviteInfo, type JoinableWorkspace, type Me, type MePatch, type OnboardingIn, type SignedIn, type SlugCheck, type Workspace, type WorkspacePatch, type Member, type Person, type PlanFeatures, type PlanLimits, type Role, type Team, type ThreadBulkAction, type Billing, type BillingPlan, type Charge, type Checkout, type Invoice, type LedgerEntry, type LedgerKind, type Overview, type Widget, type DashboardDraft, type AlteriaConversations, type AlteriaSignal, type AlteriaTrackers, type CallDraft, type TrackerDraft,
  type Breakdown, type BreakdownGroup, type Bucket, type Dashboard, type DashboardIn, type Series, type SeriesEvent, type SeriesPoint,
} from './api-types'
import { saveCsv } from './lib/export'
import { WORKSPACE_HOST } from './config'
import { answersOf, problem } from './conditions'
import { BILLING_ON } from './config'
import { audioProblem, isAudio } from './audio'
import { validate, validateTracker, fromSpec, title } from './signal-draft'

// ── Mock backend state ─────────────────────────────────────────────────────────

// Billing is off in the mock, like the real build (config.ts BILLING_ON). ?price=0.5 (or
// ?billing=on, or VITE_BILLING=on) turns it on with example prices ($0.50 per 1M tokens, Pro at $49),
// so every billing screen can be seen. ?pro= changes Pro's price.
// VITE_MOCK_PLAN (./start.sh --free or --pro) picks the plan; each mode keeps its own saved state.
// The rest of the switches are under Billing (B40) at the end.
const MOCK_PLAN = import.meta.env.VITE_MOCK_PLAN as 'free' | 'pro' | undefined
const PRICES_KEY = 'mock-prices'
interface MockPrices { payg: number | null; pro: number | null; proRate: number | null; proTokens: number; trial: number }
const prices: MockPrices = (() => {
  const q = new URLSearchParams(location.search)
  const n = (k: string) => (q.has(k) ? Number(q.get(k)) || null : undefined)
  let saved: Partial<MockPrices> = {}
  try {
    if (q.get('prices') === 'off') localStorage.removeItem(PRICES_KEY)
    else saved = JSON.parse(localStorage.getItem(PRICES_KEY) ?? '{}')
  } catch {
    // Storage blocked: the URL only.
  }
  const off = !BILLING_ON || q.get('billing') === 'off'
  const out: MockPrices = {
    payg: off ? null : n('price') ?? saved.payg ?? 0.5,
    pro: n('pro') ?? saved.pro ?? 49,
    proRate: n('pro_rate') ?? saved.proRate ?? 0.35,
    proTokens: n('pro_tokens') ?? saved.proTokens ?? 20_000_000,
    trial: n('trial') ?? saved.trial ?? 5,
  }
  if (out.pro !== null && out.proRate === null) out.proRate = out.payg
  try {
    if (out.payg !== null) localStorage.setItem(PRICES_KEY, JSON.stringify(out))
  } catch {
    // Not remembered.
  }
  return out
})()
const billingOn = () => prices.payg !== null
// ?fresh starts with an empty workspace, to see first-run onboarding.
const FRESH = new URLSearchParams(location.search).has('fresh')
const cost = (tokens: number) => (prices.payg === null ? null : Math.round(tokens * prices.payg) / 1e6)
const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms))
const MODEL = 'jev-1.13.0'
const REQUEST_OVERHEAD = 60

const OVER_LIMIT_MESSAGE =
  "This call is over 30,000 tokens, so it wasn't analysed and you weren't charged for it. Long calls will be supported later. Like every call they'll be billed per token, so a long call costs more because it uses more tokens."
const largeMessage = (t: number, parts: number, tokens: number, x: number) =>
  `This call is ${t.toLocaleString('en-US')} tokens. With your signals it doesn't fit in one request, so it will be sent in ${parts} parts and use about ${tokens.toLocaleString('en-US')} tokens (${x.toFixed(1)}x what a call this size uses in one request).`

const signalTokens = estimateTokens

interface StoredTracker { name: string; description: string | null; active: boolean; run_if: Condition | null; signals: Omit<Signal, 'tracker' | 'tokens'>[] }

const versions: Record<string, number> = { call_outcome: 3, asked_for_human: 1, agent_misstated_policy: 2, frustration: 1, decline_reason: 4 }
let store: StoredTracker[] = (FRESH ? [] : (sampleTrackers as { name: string; description: string; signals: SignalSpec[] }[])).map((c) => ({
  name: c.name,
  description: c.description,
  active: true,
  run_if: null,
  signals: c.signals.map((spec) => ({ name: spec.name, active: true, version: versions[spec.name] ?? 1, spec })),
}))

function trackerOut(c: StoredTracker, includeInactive = true): Tracker {
  const signals = c.signals
    .filter((q) => includeInactive || q.active)
    .map((q) => ({ ...q, tracker: c.name, tokens: signalTokens(q.spec) }))
  const ov = overlapState().colours[c.name]
  return {
    name: c.name,
    description: c.description,
    active: c.active,
    run_if: c.run_if,
    signal_tokens: signals.filter((q) => q.active).reduce((s, q) => s + q.tokens, 0),
    signals,
    color: ov?.color ?? null,
    overlaps_with: ov?.overlaps_with ?? [],
  }
}

// ── Conditions ─────────────────────────────────────────────────────────────────

/** Like Condition.describe(): the text the backend puts in messages and results. */
const said = (c: Condition) =>
  `${c.tracker}.${c.signal} ${{ in: 'in', not_in: 'not in', gte: '>=', lte: '<=' }[c.op]} ${Array.isArray(c.value) ? `[${c.value.join(', ')}]` : c.value}`

const dependents = (tracker: string, signal?: string) =>
  store.filter((c) => c.run_if && c.name !== tracker && c.run_if.tracker === tracker && (!signal || c.run_if.signal === signal))

/** Like _refuse_if_depended_on: 409 while another tracker's condition is on this. */
function refuseIfDependedOn(deps: StoredTracker[], what: string, action: string, forceHint: boolean) {
  if (!deps.length) return
  const described = deps.map((c) => `'${c.name}' runs only if ${said(c.run_if!)}`).join('; ')
  const hint = forceHint ? ' Pass force=true to turn it off anyway; those trackers then won\'t run.' : ''
  throw new ApiError(`Can't ${action} ${what}: ${described}. Change or remove those conditions first.${hint}`, [], 409)
}

function checkCondition(name: string, cond?: Condition | null): Condition | null {
  if (!cond) return null
  const bad = problem(cond, name, store.map((c) => trackerOut(c)))
  if (bad) throw new ApiError(`run_if: ${bad}`, [], 422)
  return cond
}

// ── Overlap ────────────────────────────────────────────────────────────────────

const PALETTE = ['#E4572E', '#2E86AB', '#F2A541', '#76B041', '#9B5DE5', '#00A6A6', '#D1495B', '#8D6A9F']
// What the mock "Jev" says: these pairs overlap; any other pair is mutually exclusive.
const OVERLAPPING = new Set(['compliance|experience'])
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
/** Answers for pairs checked since either side last changed. Editing a tracker or its signals drops its pairs. */
let overlapAnswers = new Map<string, boolean>()
const forgetOverlap = (name: string) => [...overlapAnswers.keys()].filter((k) => k.split('|').includes(name)).forEach((k) => overlapAnswers.delete(k))
const checkable = () => store.filter((c) => c.active && c.signals.some((q) => q.active)).map((c) => c.name)

function overlapState() {
  const names = checkable()
  const pairs = names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b] as [string, string]))
  const edges = new Map(names.map((n) => [n, new Set<string>()]))
  for (const [a, b] of pairs) {
    if (!overlapAnswers.get(pairKey(a, b))) continue
    edges.get(a)!.add(b)
    edges.get(b)!.add(a)
  }
  const colours: Overlap['trackers'] = {}
  let group = 0
  for (const n of names) {
    if (colours[n]) continue
    if (!edges.get(n)!.size) {
      colours[n] = { group: null, color: null, overlaps_with: [] }
      continue
    }
    group++
    const seen = new Set([n])
    for (const stack = [n]; stack.length;) {
      for (const m of edges.get(stack.pop()!)!) {
        if (seen.has(m)) continue
        seen.add(m)
        stack.push(m)
      }
    }
    for (const m of seen) colours[m] = { group, color: PALETTE[(group - 1) % PALETTE.length], overlaps_with: names.filter((x) => edges.get(m)!.has(x)) }
  }
  return { names, pairs, colours }
}

function overlapOut(asked: number): Overlap {
  const { pairs, colours } = overlapState()
  return {
    trackers: colours,
    pairs: pairs.filter(([a, b]) => overlapAnswers.has(pairKey(a, b))).map(([a, b]) => {
      const overlaps = overlapAnswers.get(pairKey(a, b))!
      return { a, b, overlaps, probability: overlaps ? 0.83 : 0.09, confidence: overlaps ? 0.66 : 0.82, cached: true }
    }),
    unchecked: pairs.filter(([a, b]) => !overlapAnswers.has(pairKey(a, b))),
    asked,
    billed: false,
  }
}

/** Active signals of the chosen trackers, like worker.active_signals. */
function activeSignals(chosen: string[]): Signal[] {
  return store
    .filter((c) => c.active && chosen.includes(c.name))
    .flatMap((c) => trackerOut(c, false).signals)
}

/** Same checks as the backend's _resolve_categories. */
function resolveTrackers(requested?: string[]): string[] {
  const withSignals = new Set(store.filter((c) => c.active && c.signals.some((q) => q.active)).map((c) => c.name))
  const runIf = (n: string) => store.find((c) => c.name === n)?.run_if
  if (!requested) {
    let chosen = store.filter((c) => withSignals.has(c.name)).map((c) => c.name)
    for (let dropped: string[]; (dropped = chosen.filter((n) => runIf(n) && !chosen.includes(runIf(n)!.tracker))).length;) {
      chosen = chosen.filter((n) => !dropped.includes(n))
    }
    return chosen
  }
  const chosen = [...new Set(requested)]
  if (!chosen.length) throw new ApiError('Choose at least one tracker')
  const active = new Set(store.filter((c) => c.active).map((c) => c.name))
  const errors = [
    ...chosen.filter((n) => !active.has(n)).map((n) => `Tracker '${n}' doesn't exist or is inactive`),
    ...chosen.filter((n) => active.has(n) && !withSignals.has(n)).map((n) => `Tracker '${n}' has no active signals`),
    ...chosen.filter((n) => active.has(n) && runIf(n) && !chosen.includes(runIf(n)!.tracker))
      .map((n) => `Tracker '${n}' runs only if ${said(runIf(n)!)}; choose '${runIf(n)!.tracker}' as well`),
  ]
  if (errors.length) throw new ApiError(errors.join('. '), errors, 422)
  return chosen
}

/** Like planner.estimate: one request if everything fits, otherwise signals are split across
 *  requests and each carries the full transcript. Null = over the limit. */
function plan(transcript: number, qs: number[]) {
  const single = transcript + REQUEST_OVERHEAD + qs.reduce((a, b) => a + b, 0)
  if (single <= TOKEN_BUDGET) return { requests: 1, tokens: single, single, multiplier: 1 }
  const room = TOKEN_BUDGET - transcript - REQUEST_OVERHEAD
  if (room < Math.max(...qs)) return null
  const bins: number[] = []
  for (const q of [...qs].sort((a, b) => b - a)) {
    const i = bins.findIndex((b) => b + q <= room)
    if (i >= 0) bins[i] += q
    else bins.push(q)
  }
  const tokens = bins.length * (transcript + REQUEST_OVERHEAD) + qs.reduce((a, b) => a + b, 0)
  return { requests: bins.length, tokens, single, multiplier: tokens / single }
}

type Turn = { speaker: string; text: string }
const samples = sampleCalls.calls as { external_id: string; agent_id: string; agent_version: string; started_at: string; transcript: Turn[] | string }[]
// Same as the backend's render_transcript: a string, or a list of turns.
const render = (t: Turn[] | string) => (typeof t === 'string' ? t : t.map((x) => `${x.speaker}: ${x.text}`).join('\n'))
// Stand-in for a very long call: the four conversational samples, over and over.
const longText = (times: number) => Array.from({ length: times }, () => samples.slice(0, 4).map((c) => render(c.transcript))).flat().join('\n')

// Big enough that the largest signal only just fits beside it, so with every tracker on
// it's split into several parts, and with one small tracker it fits in a single request.
const NEAR_LIMIT_TOKENS = TOKEN_BUDGET - REQUEST_OVERHEAD - 200

// [external_id, transcript tokens, answers by signal]
// answers: choice → [option, confidence]; yes_no → p(yes); score → [value, confidence]
type Raw = [string, number] | number | [number, number]
const ROWS: [string, number, Record<string, Raw>][] = [
  ['sample-001', 212, { call_outcome: ['booked', 0.97], decline_reason: ['not_applicable', 0.95], agent_misstated_policy: 0.06, asked_for_human: 0.03, frustration: [0.08, 0.91] }],
  ['sample-002', 198, { call_outcome: ['declined', 0.93], decline_reason: ['price', 0.96], agent_misstated_policy: 0.09, asked_for_human: 0.04, frustration: [1.1, 0.71] }],
  ['sample-003', 247, { call_outcome: ['other', 0.48], decline_reason: ['other', 0.52], agent_misstated_policy: 0.71, asked_for_human: 0.92, frustration: [2.8, 0.66] }],
  ['sample-004', 161, { call_outcome: ['rescheduled', 0.95], decline_reason: ['not_applicable', 0.93], agent_misstated_policy: 0.05, asked_for_human: 0.02, frustration: [0.06, 0.89] }],
  ['sample-005', 64, { call_outcome: ['no_answer', 0.88], decline_reason: ['not_stated', 0.57], agent_misstated_policy: 0.04, asked_for_human: 0.03, frustration: [0.04, 0.94] }],
  ['near-limit-01', NEAR_LIMIT_TOKENS, { call_outcome: ['declined', 0.81], decline_reason: ['timing', 0.74], agent_misstated_policy: 0.31, asked_for_human: 0.12, frustration: [1.9, 0.58] }],
]
const OVER_LIMIT_TOKENS = 31_999

function spread(keys: string[], top: string, c: number): Record<string, number> {
  const rest = keys.filter((k) => k !== top)
  const weights = rest.map((_, i) => 1 / (i + 2))
  const sum = weights.reduce((a, b) => a + b, 0)
  return Object.fromEntries([[top, c], ...rest.map((k, i) => [k, ((1 - c) * weights[i]) / sum])])
}

function mockAnswers(raw: Record<string, Raw>, qs: Signal[]): Answers {
  const out: Answers = {}
  for (const q of qs) {
    const r = raw[q.name]
    if (r === undefined) continue
    const threshold = q.spec.review_threshold ?? 0.6
    const base = { signal_version: String(q.version), version_number: q.version }
    let a: Answer
    if (q.spec.type === 'yes_no') {
      const p = r as number
      const confidence = Math.abs(2 * p - 1)
      a = { ...base, type: 'yes_no', value: p >= 0.5 ? 'yes' : 'no', probability_yes: p, confidence, needs_review: confidence < threshold, probabilities: { yes: p, no: 1 - p } }
    } else if (q.spec.type === 'score') {
      const [value, confidence] = r as [number, number]
      const levels = (q.spec.criteria as string[]).map((_, j) => String(j))
      a = { ...base, type: 'score', value, confidence, needs_review: confidence < threshold, probabilities: spread(levels, String(Math.round(value)), confidence) }
    } else {
      const [value, confidence] = r as [string, number]
      const keys = Object.keys(q.spec.criteria as Record<string, string>)
      a = { ...base, type: 'choice', value, confidence, needs_review: confidence < threshold, probabilities: spread(keys, value, confidence) }
    }
    ;(out[q.tracker] ??= {})[q.name] = a
  }
  return out
}

/** Like worker.check_condition, applied in order so a gate that didn't run stops its branch too. */
function applyConditions(answers: Answers, chosen: string[]): Record<string, ConditionCheck> {
  const out: Record<string, ConditionCheck> = {}
  const notRun = new Set<string>()
  const pending = chosen.filter((n) => store.find((c) => c.name === n)?.run_if)
  for (let guard = 0; pending.length && guard < 20; guard++) {
    for (const n of [...pending]) {
      const cond = store.find((c) => c.name === n)!.run_if!
      if (pending.includes(cond.tracker)) continue // its gate is decided first
      pending.splice(pending.indexOf(n), 1)
      const check: ConditionCheck = { run_if: cond, condition: said(cond), met: false, value: null, reason: null }
      const a = answers[cond.tracker]?.[cond.signal]
      if (notRun.has(cond.tracker)) check.reason = `'${cond.tracker}' didn't run on this call, so this tracker didn't either`
      else if (!a) check.reason = `No answer for ${cond.tracker}.${cond.signal} on this call`
      else {
        check.value = a.type === 'score' ? (a.value as number) : String(a.value)
        const text = a.type === 'score' ? String(Math.round(a.value as number)) : String(a.value)
        check.met = cond.op === 'in' ? (cond.value as string[]).includes(text)
          : cond.op === 'not_in' ? !(cond.value as string[]).includes(text)
          : cond.op === 'gte' ? (a.value as number) >= (cond.value as number)
          : (a.value as number) <= (cond.value as number)
        if (!check.met) check.reason = `${cond.tracker}.${cond.signal} was '${check.value}', so '${said(cond)}' doesn't hold`
      }
      if (!check.met) {
        notRun.add(n)
        delete answers[n]
      }
      out[n] = check
    }
  }
  return out
}

let nextCallId = 1
function mockCalls(chosen: string[]): CallResult[] {
  const qs = activeSignals(chosen)
  const qt = qs.map((q) => q.tokens)
  const calls: CallResult[] = ROWS.map(([id, t, raw], i) => {
    const s = samples[i] ?? { ...samples[1], external_id: id, agent_version: 'v13', started_at: '2026-09-25T16:48:00+05:30', transcript: longText(40) }
    const p = plan(t, qt)!
    const billed = Math.round(p.tokens * (0.975 + (i % 3) * 0.008))
    const answers = mockAnswers(raw, qs)
    const conditions = applyConditions(answers, chosen)
    return {
      call_id: `c-${nextCallId++}`,
      external_id: id,
      agent_id: s.agent_id,
      agent_version: s.agent_version,
      started_at: s.started_at,
      trackers: chosen,
      status: 'done',
      message: null,
      tokens: { transcript: t, billed_input: billed, output: 0 },
      requests: p.requests,
      estimate: { requests: p.requests, tokens: p.tokens, cost: cost(p.tokens) },
      cost: cost(billed),
      large: p.requests > 1,
      warning: p.requests > 1 ? largeMessage(t, p.requests, p.tokens, p.multiplier) : null,
      model: MODEL,
      answers,
      conditions,
      transcript: render(s.transcript),
    }
  })
  calls.push({
    call_id: `c-${nextCallId++}`, external_id: 'over-limit-01', agent_id: 'clinic-booking', agent_version: 'v13', started_at: '2026-09-25T17:30:00+05:30',
    trackers: chosen, status: 'over_limit', message: OVER_LIMIT_MESSAGE, tokens: { transcript: OVER_LIMIT_TOKENS, billed_input: 0, output: 0 }, requests: 0,
    estimate: { requests: null, tokens: null, cost: null }, cost: null, large: false, warning: null, model: null, answers: {}, conditions: {},
    transcript: longText(44),
  })
  return calls
}

/** `transcribeMs`: an audio upload spends this long "transcribing" (Gemini, in the background) before the calls queue. */
interface MockUpload { status: UploadStatus; calls: CallResult[]; startedAt: number; transcribeMs?: number }
const TRANSCRIBE_MS = 4000
const seeded = (id: string, filename: string, created_at: string, chosen: string[]): MockUpload => {
  const calls = mockCalls(chosen)
  const over = calls.filter((c) => c.status === 'over_limit').length
  return {
    status: { upload_id: id, filename, trackers: chosen, created_at, complete: true, counts: { queued: 0, processing: 0, done: calls.length - over, failed: 0, over_limit: over } },
    calls,
    startedAt: 0,
  }
}
let uploads: MockUpload[] = FRESH ? [] : [
  seeded('u-2', 'clinic-calls-sep-week3.json', '2026-09-25T18:02:00+05:30', ['outcome', 'compliance', 'experience']),
  seeded('u-1', 'policy-spotcheck.jsonl', '2026-09-22T11:40:00+05:30', ['compliance']),
]

// Calls finish one by one so the progress screen has something to show.
function progress(u: MockUpload): MockUpload {
  if (!u.startedAt) return u
  const runnable = u.calls.filter((c) => c.status !== 'over_limit')
  const elapsed = Date.now() - u.startedAt
  if (u.transcribeMs && elapsed < u.transcribeMs) {
    u.status = { ...u.status, counts: { transcribing: runnable.length, queued: 0, processing: 0, done: 0, failed: 0, over_limit: u.calls.length - runnable.length }, complete: false }
    return u
  }
  const finished = Math.min(runnable.length, Math.floor((elapsed - (u.transcribeMs ?? 0)) / 900))
  const counts = { queued: Math.max(0, runnable.length - finished - 1), processing: finished < runnable.length ? 1 : 0, done: finished, failed: 0, over_limit: u.calls.length - runnable.length }
  u.status = { ...u.status, counts, complete: finished === runnable.length }
  return u
}

function withLiveStatus(u: MockUpload): CallResult[] {
  const runnable = u.calls.filter((c) => c.status !== 'over_limit')
  const done = new Set(runnable.slice(0, u.status.counts.done).map((c) => c.call_id))
  const processing = runnable[u.status.counts.done]?.call_id
  const transcribing = !!u.status.counts.transcribing
  return u.calls.map((c) =>
    c.status === 'over_limit' || done.has(c.call_id)
      ? c
      : { ...c, status: transcribing ? 'transcribing' : c.call_id === processing && u.status.counts.processing ? 'processing' : 'queued', answers: {}, conditions: {}, tokens: { ...c.tokens, billed_input: 0 }, requests: 0, cost: null, model: null },
  )
}

function findUpload(id: string): MockUpload {
  const u = uploads.find((x) => x.status.upload_id === id)
  if (!u) throw new ApiError('Upload not found')
  return progress(u)
}

// ── Trackers and signals ───────────────────────────────────────────────────────

/** GET /trackers?include_inactive=true */
export async function listTrackers(): Promise<Tracker[]> {
  await wait(250)
  return structuredClone(store.map((c) => trackerOut(c)))
}

/** POST /trackers (new) or PUT /trackers/{name} (updates the description, reactivates). */
export async function saveTracker(spec: TrackerSpec, isNew: boolean): Promise<Tracker> {
  await wait()
  const existing = store.find((c) => c.name === spec.name)
  if (isNew && existing) throw new ApiError(`Tracker '${spec.name}' exists; use PUT /trackers/${spec.name}`, [], 409)
  if (!isNew && !existing) throw new ApiError(`No tracker named '${spec.name}'`, [], 404)
  const run_if = checkCondition(spec.name, spec.run_if) // a PUT without run_if removes it, like the backend
  const next: StoredTracker = { signals: [], ...existing, name: spec.name, description: spec.description || null, active: true, run_if }
  store = existing ? store.map((c) => (c.name === spec.name ? next : c)) : [...store, next]
  if (existing?.description !== next.description) forgetOverlap(spec.name)
  return structuredClone(trackerOut(next))
}

/** DELETE /trackers/{name}: stops it running on new uploads; signals and answers are kept.
 *  409 while another tracker's condition is on it, unless `force`. */
export async function deactivateTracker(name: string, force = false): Promise<void> {
  await wait()
  if (!force) refuseIfDependedOn(dependents(name), `tracker '${name}'`, 'turn off', true)
  store = store.map((c) => (c.name === name ? { ...c, active: false } : c))
}

/** POST /trackers/{tracker}/signals (new) or PUT …/signals/{name} (new version; reactivates). */
export async function saveSignal(tracker: string, spec: SignalSpec, isNew: boolean): Promise<Signal> {
  await wait()
  const c = store.find((x) => x.name === tracker)
  if (!c) throw new ApiError(`No tracker named '${tracker}'`)
  const existing = c.signals.find((q) => q.name === spec.name)
  if (isNew && existing) throw new ApiError(`Signal '${spec.name}' exists in '${tracker}'; edit it instead`, [], 409)
  const broken = dependents(tracker, spec.name).filter((d) => {
    const allowed = answersOf(spec).map((a) => a.value)
    const r = d.run_if!
    return spec.type === 'score' ? Array.isArray(r.value) : !Array.isArray(r.value) || r.value.some((v) => !allowed.includes(v))
  })
  if (broken.length) {
    throw new ApiError(`This edit would break conditions on ${tracker}.${spec.name}: ${broken.map((d) => `'${d.name}' runs only if ${said(d.run_if!)}`).join('; ')}. Change those conditions first.`, [], 409)
  }
  forgetOverlap(tracker)
  const saved = { name: spec.name, active: true, version: (existing?.version ?? 0) + 1, spec }
  c.signals = existing ? c.signals.map((q) => (q.name === spec.name ? saved : q)) : [...c.signals, saved]
  return structuredClone({ ...saved, tracker, tokens: signalTokens(spec) })
}

/** DELETE /trackers/{tracker}/signals/{name}: 409 while a condition is on it, unless `force`. */
export async function deactivateSignal(tracker: string, name: string, force = false): Promise<void> {
  await wait()
  if (!force) refuseIfDependedOn(dependents(tracker, name), `signal ${tracker}.${name}`, 'turn off', true)
  forgetOverlap(tracker)
  const c = store.find((x) => x.name === tracker)
  if (c) c.signals = c.signals.map((q) => (q.name === name ? { ...q, active: false } : q))
}

/** DELETE /trackers/{name}?permanent=true (request B5): removes the tracker and its signals for
 *  good, and frees the name. Past results keep their answers. */
export async function deleteTracker(name: string): Promise<void> {
  await wait()
  if (!store.some((c) => c.name === name)) throw new ApiError(`No tracker named '${name}'`, [], 404)
  refuseIfDependedOn(dependents(name), `tracker '${name}'`, 'delete', false)
  store = store.filter((c) => c.name !== name)
  forgetOverlap(name)
}

/** DELETE /trackers/{tracker}/signals/{name}?permanent=true (request B5). */
export async function deleteSignal(tracker: string, name: string): Promise<void> {
  await wait()
  const c = store.find((x) => x.name === tracker)
  if (!c?.signals.some((q) => q.name === name)) throw new ApiError(`No signal named '${name}' in '${tracker}'`, [], 404)
  refuseIfDependedOn(dependents(tracker, name), `signal ${tracker}.${name}`, 'delete', false)
  c.signals = c.signals.filter((q) => q.name !== name)
  forgetOverlap(tracker)
}

/** POST /trackers/import: all or nothing; every problem is listed, with its place in the file. */
export async function importTrackers(file: File, opts: { dryRun: boolean; onConflict: OnConflict }): Promise<ImportResult> {
  await wait(600)
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new ApiError(`${file.name} isn't valid JSON`, [`${file.name} isn't valid JSON`], 422)
  }
  const items = (Array.isArray(raw) ? raw : (raw as { trackers?: unknown })?.trackers) as { name: string; description?: string; run_if?: Condition; signals?: SignalSpec[] }[] | undefined
  if (!Array.isArray(items)) throw new ApiError('Expected a list of trackers, or {"trackers": [...]}', [], 422)
  const errors: string[] = []
  items.forEach((t, i) => {
    const where = `trackers[${i}] ('${t?.name}')`
    const te = validateTracker(String(t?.name ?? ''), t?.description ?? '')
    if (te.name) errors.push(`${where}.name: ${te.name}`)
    if (!Array.isArray(t?.signals)) return void errors.push(`${where}.signals: a list of signals is required`)
    t.signals.forEach((sp, j) => {
      const se = sp?.type ? validate(fromSpec(sp)) : { name: 'type is required' }
      for (const msg of Object.values(se)) errors.push(`${where}.signals[${j}] ('${sp?.name}'): ${msg}`)
    })
  })
  if (errors.length) throw new ApiError(errors.join('. '), errors, 422)
  const clash = items.filter((t) => store.some((c) => c.name === t.name)).map((t) => t.name)
  if (opts.onConflict === 'fail' && clash.length) {
    const e = clash.map((n) => `Tracker '${n}' already exists; use on_conflict=skip or on_conflict=update`)
    throw new ApiError(e.join('. '), e, 409)
  }
  const before = structuredClone(store)
  const out: ImportResult = { dry_run: opts.dryRun, created: [], updated: [], skipped: [], signals_created: 0, signals_updated: 0, signals_unchanged: 0, trackers: [], overlap: null, overlap_error: null }
  const touched: StoredTracker[] = []
  for (const t of items) {
    let c = store.find((x) => x.name === t.name)
    if (c && opts.onConflict === 'skip') {
      out.skipped.push(t.name)
      continue
    }
    if (!c) {
      c = { name: t.name, description: t.description ?? null, active: true, run_if: null, signals: [] }
      store.push(c)
      out.created.push(t.name)
    } else {
      Object.assign(c, { description: t.description ?? null, active: true })
      out.updated.push(t.name)
    }
    touched.push(c)
    for (const spec of t.signals!) {
      const q = c.signals.find((x) => x.name === spec.name)
      if (!q) {
        c.signals.push({ name: spec.name, active: true, version: 1, spec })
        out.signals_created++
      } else if (q.active && JSON.stringify(q.spec) === JSON.stringify(spec)) out.signals_unchanged++
      else {
        Object.assign(q, { spec, active: true, version: q.version + 1 })
        out.signals_updated++
      }
    }
  }
  // Conditions last, so they can point at trackers earlier in the same file.
  for (const c of touched) {
    try {
      c.run_if = checkCondition(c.name, items.find((t) => t.name === c.name)!.run_if)
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`)
    }
  }
  if (errors.length || opts.dryRun) {
    const result = { ...out, trackers: touched.map((c) => trackerOut(c)) }
    store = before
    if (errors.length) throw new ApiError(errors.join('. '), errors, 422)
    return structuredClone(result)
  }
  touched.forEach((c) => forgetOverlap(c.name))
  out.overlap = await checkOverlap()
  out.trackers = touched.map((c) => trackerOut(c))
  return structuredClone(out)
}

/** GET /overlap: stored answers only. */
export async function getOverlap(): Promise<Overlap> {
  await wait(200)
  return overlapOut(0)
}

/** POST /overlap: "asks Jev" about every pair not checked yet. Free. */
export async function checkOverlap(): Promise<Overlap> {
  await wait(900)
  const { pairs } = overlapState()
  const missing = pairs.filter(([a, b]) => !overlapAnswers.has(pairKey(a, b)))
  for (const [a, b] of missing) overlapAnswers.set(pairKey(a, b), OVERLAPPING.has(pairKey(a, b)))
  return overlapOut(missing.length)
}

// ── Uploads ────────────────────────────────────────────────────────────────────

function checkFile(file: File) {
  // B51: any transcript layout. The real backend normalises each into turns; the mock reads the samples.
  const tooBig = audioProblem(file)
  if (tooBig) throw new ApiError(tooBig)
  if (!/\.(csv|json|jsonl|txt|vtt|srt|mp3|wav|m4a|ogg|webm|flac)$/i.test(file.name)) throw new ApiError(`aftercall can’t read ${file.name} yet. Use CSV, JSON, JSONL, plain text, VTT or SRT, or a recording (MP3, WAV, M4A, OGG, WebM, FLAC).`)
}

/** POST /uploads?dry_run=true&trackers=a,b. The mock returns the sample calls whatever the file holds. */
export async function dryRun(file: File, trackers?: string[]): Promise<UploadOut> {
  await wait(700)
  checkFile(file)
  const chosen = resolveTrackers(trackers)
  const qs = activeSignals(chosen)
  if (!qs.length) throw new ApiError('Create at least one tracker with a signal before uploading calls')
  const audio = isAudio(file.name)
  const calls = audio ? mockCalls(chosen).slice(0, 1) : mockCalls(chosen) // a recording is one call
  const runnable = calls.filter((c) => c.status !== 'over_limit')
  const tokens = runnable.reduce((s, c) => s + (c.estimate.tokens ?? 0), 0)
  const single = (t: number) => plan(t, qs.map((q) => q.tokens))!.single
  const flagged = calls.flatMap((c, i): Flagged[] =>
    c.status === 'over_limit'
      ? [{ row: i + 1, external_id: c.external_id, flag: 'over_limit', transcript_tokens: c.tokens.transcript, requests: 0, estimated_tokens: 0, multiplier: null, message: OVER_LIMIT_MESSAGE }]
      : c.large
        ? [{ row: i + 1, external_id: c.external_id, flag: 'large', transcript_tokens: c.tokens.transcript, requests: c.requests, estimated_tokens: c.estimate.tokens!, multiplier: +(c.estimate.tokens! / single(c.tokens.transcript)).toFixed(2), message: c.warning! }]
        : [],
  )
  return {
    upload_id: null,
    dry_run: true,
    filename: file.name,
    trackers: chosen,
    conditional: chosen.filter((n) => store.find((c) => c.name === n)?.run_if),
    signals: qs.length,
    received: calls.length,
    queued: runnable.length,
    over_limit: calls.length - runnable.length,
    large: flagged.filter((f) => f.flag === 'large').length,
    duplicates: 0,
    // Audio has no transcript yet, so the backend can't count tokens: null means "after transcription".
    estimate: audio
      ? { requests: 0, tokens: null, price_per_million_tokens: prices.payg, cost: null }
      : { requests: runnable.reduce((s, c) => s + c.requests, 0), tokens, price_per_million_tokens: prices.payg, cost: cost(tokens) },
    over_limit_message: calls.length > runnable.length ? OVER_LIMIT_MESSAGE : null,
    flagged,
    charge: billingOn() && !audio ? runQuote(tokens) : null,
  }
}

/** POST /uploads?trackers=a,b */
export async function createUpload(file: File, trackers?: string[]): Promise<string> {
  await wait(600)
  checkFile(file)
  const chosen = resolveTrackers(trackers)
  const upload_id = `u-${Math.max(0, ...uploads.map((u) => Number(u.status.upload_id.slice(2)))) + 1}`
  const audio = isAudio(file.name)
  const calls = audio ? mockCalls(chosen).slice(0, 1) : mockCalls(chosen)
  const over = calls.filter((c) => c.status === 'over_limit').length
  if (billingOn()) hold(upload_id, calls.filter((c) => c.status !== 'over_limit').reduce((s, c) => s + (c.estimate.tokens ?? 0), 0), calls.length - over)
  const queued = calls.length - over
  uploads.unshift({
    status: { upload_id, filename: file.name, trackers: chosen, created_at: new Date().toISOString(), complete: false, counts: { queued: audio ? 0 : queued, transcribing: audio ? queued : 0, processing: 0, done: 0, failed: 0, over_limit: over } },
    calls,
    startedAt: Date.now(),
    transcribeMs: audio ? TRANSCRIBE_MS : undefined,
  })
  return upload_id
}

/** GET /uploads/{id} */
export async function getUpload(id: string): Promise<UploadStatus> {
  await wait(150)
  return structuredClone(findUpload(id).status)
}

/** GET /uploads: newest first. */
export async function listUploads(): Promise<UploadStatus[]> {
  await wait(200)
  return uploads.map((u) => structuredClone(progress(u).status))
}

/** GET /uploads/{id}/results */
export async function getResults(id: string): Promise<CallResult[]> {
  await wait(400)
  return withLiveStatus(findUpload(id)).map((c) => structuredClone({ ...c, transcript: undefined }))
}

/** GET /calls/{id}?include_transcript=true */
export async function getCall(id: string): Promise<CallResult> {
  await wait(300)
  if (isPopId(id)) {
    const c = population().find((x) => x.call_id === id)
    if (c) return structuredClone({ ...c, transcript: popTranscript(c) })
  }
  for (const u of uploads) {
    const c = withLiveStatus(progress(u)).find((x) => x.call_id === id)
    if (c) return structuredClone(c)
  }
  throw new ApiError('Call not found')
}

/** DELETE /uploads/{id}: the upload and its calls, for good. Usage keeps the tokens. */
export async function deleteUpload(id: string): Promise<void> {
  await wait()
  const u = findUpload(id)
  if (u.status.counts.processing) throw new ApiError('A call in this upload is being analysed right now; try again in a few seconds', [], 409)
  uploads.splice(uploads.indexOf(u), 1)
}

/** DELETE /calls/{id} */
export async function deleteCall(id: string): Promise<void> {
  await wait()
  if (isPopId(id) && popBase?.some((c) => c.call_id === id)) {
    popBase = popBase.filter((c) => c.call_id !== id)
    return
  }
  for (const u of uploads) {
    const c = withLiveStatus(progress(u)).find((x) => x.call_id === id)
    if (!c) continue
    if (c.status === 'processing' || c.status === 'transcribing') throw new ApiError(`Call ${id} is being analysed right now; try again in a few seconds`, [], 409)
    u.calls = u.calls.filter((x) => x.call_id !== id)
    const key = c.status === 'queued' ? 'queued' : c.status
    u.status.counts = { ...u.status.counts, [key]: Math.max(0, (u.status.counts[key] ?? 0) - 1) }
    return
  }
  throw new ApiError('Call not found', [], 404)
}

/** GET /uploads/{id}/export.csv. Real version: fetch with X-API-Key, then the same blob download. */
export async function downloadExport(id: string): Promise<void> {
  await wait(300)
  const results = withLiveStatus(findUpload(id))
  const names = [...new Set(results.flatMap((r) => Object.entries(r.answers).flatMap(([c, qs]) => Object.keys(qs).map((q) => `${c}.${q}`))))]
  const head = ['call_id', 'external_id', 'trackers', 'status', 'billed_input_tokens', 'requests', 'large', ...names.flatMap((n) => [n, `${n}_confidence`, `${n}_needs_review`])]
  const rows = results.map((r) => [
    r.call_id, r.external_id, r.trackers.join('|'), r.status, r.tokens.billed_input, r.requests, r.large,
    ...names.flatMap((n) => {
      const [c, q] = n.split('.')
      const a = r.answers[c]?.[q]
      return a ? [a.value, a.confidence, a.needs_review] : ['', '', '']
    }),
  ].join(','))
  const blob = new Blob(['﻿' + [head.join(','), ...rows].join('\n')], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `aftercall-upload-${id}.csv` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000) // Safari needs the URL alive a moment after click()
}

// ── Usage ──────────────────────────────────────────────────────────────────────

// 14 days of plausible traffic for one clinic chain; the 21st had a batch of long calls.
const DAILY: [number, number, number, number][] = [
  // calls, requests, billed tokens, over-limit calls
  [182, 186, 214_380, 0], [205, 209, 238_902, 1], [96, 96, 108_441, 0], [88, 88, 97_530, 0],
  [231, 239, 318_774, 0], [247, 251, 290_117, 2], [263, 263, 301_952, 0], [258, 262, 309_486, 0],
  [274, 291, 612_059, 3], [119, 119, 131_208, 0], [102, 102, 116_873, 0], [289, 297, 402_315, 1],
  [301, 305, 356_690, 0], [317, 322, 371_044, 1],
]

/** GET /usage?start=&end= */
export async function getUsage(start: string, end: string): Promise<Usage> {
  await wait(400)
  const days: UsageDay[] = DAILY.map(([calls, reqs, billed, over], i) => ({
    date: new Date(Date.UTC(2026, 8, 13 + i)).toISOString().slice(0, 10),
    calls_analyzed: calls,
    jev_requests: reqs,
    billed_input_tokens: billed,
    output_tokens: 0,
    over_limit_calls: over,
    over_limit_tokens: over * 33_412,
    cost: cost(billed),
  })).filter((d) => (!start || d.date >= start) && (!end || d.date <= end))
  const sum = (k: keyof UsageDay) => days.reduce((s, d) => s + (d[k] as number), 0)
  return {
    pricing: { unit: 'per 1M input tokens used', price: prices.payg },
    token_budget: TOKEN_BUDGET,
    days,
    totals: {
      calls_analyzed: sum('calls_analyzed'), jev_requests: sum('jev_requests'), billed_input_tokens: sum('billed_input_tokens'),
      output_tokens: 0, over_limit_calls: sum('over_limit_calls'), over_limit_tokens: sum('over_limit_tokens'), cost: cost(sum('billed_input_tokens')),
    },
  }
}

// ── Insights (B6, B7, B11) ─────────────────────────────────────────────────────
// A seeded population of conversations across 60 days, so Insights has enough to show:
// voice-agent calls (clinic-booking v12, then v13 from 15 days ago), front-desk calls by
// people (with a rep), and WhatsApp chats. The answers follow whatever trackers and
// signals exist now. Stories baked in: v13 raises asked_for_human and lowers
// agent_misstated_policy; chats end "other" more; Rohan books less than the other reps.

const isPopId = (id: string) => id.startsWith('c-pop-')
const POP_SIZE = 2400
const POP_DAYS = 60
const V13_DAYS_AGO = 15
const VERSION_CHANGE_DAYS_AGO = 20 // calls older than this were answered by the previous signal version

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (str: string) => [...str].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7)
const pick = <T,>(r: () => number, weights: [T, number][]): T => {
  let x = r() * weights.reduce((a, [, w]) => a + w, 0)
  for (const [v, w] of weights) if ((x -= w) <= 0) return v
  return weights[weights.length - 1][0]
}
const dayStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

interface Traits {
  daysAgo: number
  outcome: string
  reason: string
  human: boolean
  misstated: boolean
  frustration: number
  sample: number
}
interface PopCall extends CallResult { day: string; traits: Traits }

let popBase: PopCall[] | undefined
function popCalls(): PopCall[] {
  if (popBase) return popBase
  const r = rng(20260927)
  popBase = Array.from({ length: POP_SIZE }, (_, i) => {
    const daysAgo = Math.floor(r() ** 1.12 * POP_DAYS) // a little busier lately
    const channel = pick(r, [['voice_agent', 50], ['call', 30], ['chat', 20]])
    const v13 = channel === 'voice_agent' && daysAgo < V13_DAYS_AGO
    const rep = channel === 'call' ? pick(r, [['Meera', 3], ['Arjun', 3], ['Kavya', 2], ['Rohan', 2]]) : undefined
    const outcome = channel === 'chat'
      ? pick(r, [['booked', 30], ['rescheduled', 20], ['declined', 26], ['no_answer', 4], ['other', 20]])
      : channel === 'call'
        ? pick(r, [['booked', rep === 'Rohan' ? 30 : 44], ['rescheduled', 16], ['declined', rep === 'Rohan' ? 34 : 24], ['no_answer', 8], ['other', 8]])
        : pick(r, [['booked', v13 ? 32 : 36], ['rescheduled', 14], ['declined', 22], ['no_answer', 18], ['other', v13 ? 14 : 10]])
    const reason = outcome === 'declined'
      ? pick(r, [['price', 36], ['timing', 26], ['already_booked_elsewhere', 14], ['not_stated', 18], ['other', 6]])
      : outcome === 'booked' || outcome === 'rescheduled' ? 'not_applicable'
      : outcome === 'no_answer' ? 'not_stated' : pick(r, [['other', 1], ['not_stated', 1]])
    const humanBase = channel === 'call' ? 0.01 : channel === 'chat' ? 0.07 : v13 ? 0.11 : 0.04
    const human = r() < humanBase + (outcome === 'other' ? 0.25 : 0)
    const misstated = r() < (channel === 'voice_agent' ? (v13 ? 0.03 : 0.08) : channel === 'chat' ? 0.04 : 0.05)
    const base = { booked: 0, rescheduled: 0.3, no_answer: 0, declined: 1, other: 1.8 }[outcome] ?? 0.5
    const frustration = Math.max(0, Math.min(3, Math.round(base + (human ? 1 : 0) + (r() - 0.5) * 1.4)))
    const sample = { booked: 0, declined: 1, other: 2, rescheduled: 3, no_answer: 4 }[outcome] ?? 0
    const transcript = 60 + Math.floor(r() * (channel === 'chat' ? 700 : 2400))
    const agent = channel === 'voice_agent' ? { agent_id: 'clinic-booking', agent_version: v13 ? 'v13' : 'v12' }
      : channel === 'chat' ? { agent_id: 'clinic-whatsapp', agent_version: 'v4' } : { agent_id: 'front-desk', agent_version: null }
    const metadata: Record<string, string> = {
      team: channel === 'chat' ? 'support' : pick(r, [['inbound', 4], ['outbound', 1]]),
      city: pick(r, [['Pune', 5], ['Mumbai', 3], ['Bengaluru', 2]]),
      ...(rep ? { rep } : {}),
    }
    const minute = Math.floor(r() * 600) + 540 // 9:00 to 19:00
    const day = dayStr(daysAgo)
    return {
      call_id: `c-pop-${i + 1}`,
      external_id: `${{ voice_agent: 'va', call: 'fd', chat: 'wa' }[channel]}-${String(i + 1).padStart(5, '0')}`,
      ...agent,
      started_at: `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00+05:30`,
      trackers: [],
      status: 'done',
      message: null,
      tokens: { transcript, billed_input: 0, output: 0 },
      requests: 1,
      estimate: { requests: 1, tokens: null, cost: null },
      cost: null,
      large: false,
      warning: null,
      model: MODEL,
      answers: {},
      conditions: {},
      channel,
      metadata,
      day,
      traits: { daysAgo, outcome, reason, human, misstated, frustration, sample },
    }
  })
  return popBase
}

/** Answers for every active signal, cached until the trackers change. */
let popKey = ''
function population(): PopCall[] {
  if (currentId !== SAMPLE_PROJECT) return [] // a new project has only what's uploaded to it
  const calls = popCalls()
  const chosen = store.filter((c) => c.active && c.signals.some((q) => q.active)).map((c) => c.name)
  const qs = activeSignals(chosen)
  const key = JSON.stringify([chosen, qs.map((q) => [q.tracker, q.name, q.version, q.spec]), store.map((c) => c.run_if)])
  if (key === popKey) return calls
  popKey = key
  const signalTokensTotal = qs.reduce((a, q) => a + q.tokens, 0)
  for (const c of calls) {
    const r = rng(Number(c.call_id.slice('c-pop-'.length)) + 100_000)
    const answers: Answers = {}
    for (const q of qs) {
      const t = c.traits
      const threshold = q.spec.review_threshold ?? 0.6
      const version = q.version > 1 && t.daysAgo >= VERSION_CHANGE_DAYS_AGO ? q.version - 1 : q.version
      const vague = (v: string) => v === 'other' || v === 'not_stated'
      let conf = 0.62 + r() * 0.37
      let a: Answer
      if (q.spec.type === 'yes_no') {
        const yes = q.name === 'asked_for_human' ? t.human : q.name === 'agent_misstated_policy' ? t.misstated : r() < 0.1 + (Math.abs(hash(q.name)) % 30) / 100
        if (r() < 0.06) conf = 0.2 + r() * 0.4
        const p = yes ? 0.5 + conf / 2 : 0.5 - conf / 2
        a = { type: 'yes_no', value: yes ? 'yes' : 'no', probability_yes: p, confidence: conf, needs_review: conf < threshold, probabilities: { yes: p, no: 1 - p }, signal_version: String(version), version_number: version }
      } else if (q.spec.type === 'score') {
        const n = (q.spec.criteria as string[]).length
        const level = q.name === 'frustration' ? Math.min(n - 1, t.frustration) : Math.min(n - 1, Math.max(0, Math.round(1 + (r() - 0.5) * 2.4)))
        if (r() < 0.07) conf = 0.35 + r() * 0.3
        const value = Math.max(0, Math.min(n - 1, level + (r() - 0.5) * 0.3))
        a = { type: 'score', value, confidence: conf, needs_review: conf < threshold, probabilities: spread(Array.from({ length: n }, (_, j) => String(j)), String(level), conf), signal_version: String(version), version_number: version }
      } else {
        const keys = Object.keys(q.spec.criteria as Record<string, string>)
        const known = q.name === 'call_outcome' ? t.outcome : q.name === 'decline_reason' ? t.reason : undefined
        const value = known && keys.includes(known) ? known : pick(r, keys.map((k, j) => [k, 1 / (j + 1)] as [string, number]))
        if (vague(value) || r() < 0.05) conf = 0.3 + r() * 0.45
        a = { type: 'choice', value, confidence: conf, needs_review: conf < threshold, probabilities: spread(keys, value, conf), signal_version: String(version), version_number: version }
      }
      ;(answers[q.tracker] ??= {})[q.name] = a
    }
    c.conditions = applyConditions(answers, chosen)
    c.answers = answers
    c.trackers = chosen
    const billed = c.tokens.transcript + signalTokensTotal + REQUEST_OVERHEAD
    c.tokens = { ...c.tokens, billed_input: billed }
    c.estimate = { requests: 1, tokens: billed, cost: cost(billed) }
    c.cost = cost(billed)
  }
  return calls
}

function popTranscript(c: PopCall): string {
  const t = samples[c.traits.sample]?.transcript ?? samples[0].transcript
  const text = render(t)
  return c.channel === 'chat' ? text.replaceAll(/^caller:/gm, 'customer:') : text
}

const bad = (msg: string) => new ApiError(msg, [msg], 422)

/** A `where` entry as a test on a call, or a 422 like the backend. */
function whereTest(w: string): (c: CallResult) => boolean {
  const m = /^([a-z0-9_]+)\.([a-z0-9_]+):(.+)$/.exec(w)
  if (!m) throw bad(`'${w}' isn't <tracker>.<signal>:<value>`)
  const [, tr, sig, want] = m
  const q = store.find((c) => c.name === tr)?.signals.find((x) => x.name === sig)
  if (!q) throw bad(`Unknown signal '${tr}.${sig}'`)
  return (c) => {
    const a = c.answers[tr]?.[sig]
    if (!a) return false
    if (a.type !== 'score') return String(a.value) === want
    const v = a.value as number
    if (want.startsWith('gte:')) return v >= Number(want.slice(4))
    if (want.startsWith('lte:')) return v <= Number(want.slice(4))
    return Math.round(v) === Number(want)
  }
}

function scoped(s: InsightScope): PopCall[] {
  const wheres = (s.where ?? []).map(whereTest)
  const any = (list: string[] | undefined, v: string | null | undefined) => !list?.length || (v != null && list.includes(v))
  return population().filter((c) =>
    (!s.from || c.day >= s.from) && (!s.to || c.day <= s.to) &&
    !s.uploads?.length && // the population isn't from an upload you can pick
    any(s.channel, c.channel) && any(s.agent_id, c.agent_id) && any(s.agent_version, c.agent_version) &&
    Object.entries(s.meta ?? {}).every(([k, vs]) => any(vs, c.metadata?.[k])) &&
    wheres.every((t) => t(c)),
  )
}

const shift = (s: InsightScope): InsightScope | null => {
  if (!s.from || !s.to) return null
  const len = (Date.parse(s.to) - Date.parse(s.from)) / 86_400_000 + 1
  const back = (d: string) => new Date(Date.parse(d) - len * 86_400_000).toISOString().slice(0, 10)
  return { ...s, from: back(s.from), to: back(s.to) }
}

/** GET /insights/dimensions */
export async function getDimensions(): Promise<Dimensions> {
  await wait(200)
  const calls = population()
  const tally = (vals: (string | null | undefined)[]) => {
    const n = new Map<string, number>()
    for (const v of vals) if (v) n.set(v, (n.get(v) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
  }
  const keys = tally(calls.flatMap((c) => Object.keys(c.metadata ?? {})))
  const days = calls.map((c) => c.day).sort()
  return {
    channels: tally(calls.map((c) => c.channel)),
    agents: tally(calls.map((c) => c.agent_id)).map((id) => ({ agent_id: id, versions: tally(calls.filter((c) => c.agent_id === id).map((c) => c.agent_version)).sort() })),
    metadata: Object.fromEntries(keys.map((k) => [k, tally(calls.map((c) => c.metadata?.[k]))])),
    date_range: days.length ? [days[0], days[days.length - 1]] : null,
  }
}

/** GET /insights/signals */
export async function getInsights(s: InsightScope): Promise<Insights> {
  await wait(450)
  const calls = scoped(s)
  const prev = shift(s)
  const chosen = store.filter((c) => c.active && (!s.trackers?.length || s.trackers.includes(c.name))).map((c) => c.name)
  const signals: SignalInsight[] = activeSignals(chosen).map((q) => {
    const levels = q.spec.type === 'score' ? (q.spec.criteria as string[]).map((t) => t.split(':')[0].trim()) : null
    const keys = q.spec.type === 'yes_no' ? ['yes', 'no'] : levels ? levels.map((_, j) => String(j)) : Object.keys(q.spec.criteria as Record<string, string>)
    const counts = Object.fromEntries(keys.map((k) => [k, 0]))
    const versions: Record<string, number> = {}
    const bins = Array(10).fill(0)
    let notRun = 0, answered = 0, review = 0, confSum = 0, sum = 0
    for (const c of calls) {
      if (c.conditions[q.tracker] && !c.conditions[q.tracker].met) notRun++
      const a = c.answers[q.tracker]?.[q.name]
      if (!a || (s.version === 'current' && a.signal_version !== String(q.version))) continue
      answered++
      const key = a.type === 'score' ? String(Math.round(a.value as number)) : String(a.value)
      counts[key] = (counts[key] ?? 0) + 1
      versions[a.signal_version] = (versions[a.signal_version] ?? 0) + 1
      bins[Math.min(9, Math.floor(a.confidence * 10))]++
      confSum += a.confidence
      if (a.needs_review) review++
      if (a.type === 'score') sum += a.value as number
    }
    return {
      tracker: q.tracker, signal: q.name, type: q.spec.type, versions, current_version: q.version,
      ran: calls.length - notRun, not_run: notRun, answered, counts,
      mean: q.spec.type === 'score' && answered ? sum / answered : null,
      levels: levels && Object.fromEntries(levels.map((l, j) => [String(j), l])),
      confidence: { mean: answered ? confSum / answered : 0, bins, threshold: q.spec.review_threshold ?? 0.6 },
      needs_review: review,
    }
  })
  const answers = calls.flatMap((c) => Object.values(c.answers).flatMap((t) => Object.values(t)))
  const tokens = calls.reduce((a, c) => a + c.tokens.billed_input, 0)
  return {
    scope: {
      calls: calls.length,
      calls_previous: prev ? scoped(prev).length : null,
      answers: answers.length,
      needs_review: answers.filter((a) => a.needs_review).length,
      tokens,
      cost: cost(tokens),
    },
    signals,
  }
}

/** GET /calls */
export async function listCalls(s: InsightScope, q: CallQuery = {}): Promise<CallPage> {
  await wait(300)
  let calls: CallResult[] = scoped(s)
  if (q.needs_review !== undefined) calls = calls.filter((c) => Object.values(c.answers).some((t) => Object.values(t).some((a) => a.needs_review)) === q.needs_review)
  const minConf = (c: CallResult) => Math.min(1, ...Object.values(c.answers).flatMap((t) => Object.values(t).map((a) => a.confidence)))
  const sort = q.sort ?? '-started_at'
  calls = [...calls].sort(sort === 'confidence' ? (a, b) => minConf(a) - minConf(b)
    : sort === 'started_at' ? (a, b) => a.started_at!.localeCompare(b.started_at!) : (a, b) => b.started_at!.localeCompare(a.started_at!))
  const at = Number(q.cursor ?? 0)
  const limit = Math.min(200, q.limit ?? 50)
  const page = calls.slice(at, at + limit).map((c) => {
    const { day: _d, traits: _t, ...out } = c as PopCall
    return structuredClone({ ...out, transcript: undefined })
  })
  return { calls: page, next_cursor: at + limit < calls.length ? String(at + limit) : null, total: calls.length }
}

/** An answer as the key it's counted under: an option key, yes/no, or a score's rounded level. */
const answerKey = (a: Answer) => (a.type === 'score' ? String(Math.round(a.value as number)) : String(a.value))

function signalOf(ref: string) {
  const [tr, sig] = ref.split('.')
  const q = store.find((c) => c.name === tr)?.signals.find((x) => x.name === sig)
  if (!q) throw bad(`Unknown signal '${ref}'`)
  return { tr, sig, q }
}

/** The start of the bucket a day falls in: the day, or the Monday of its week. */
function bucketOf(day: string, bucket: Bucket) {
  if (bucket === 'day') return day
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** GET /insights/series (B8) */
export async function getSeries(s: InsightScope, q: { signal?: string; bucket: Bucket }): Promise<Series> {
  await wait(380)
  const calls = scoped(s)
  const sig = q.signal ? signalOf(q.signal) : null
  const from = s.from ?? population().reduce((m, c) => (c.day < m ? c.day : m), dayStr(0))
  const to = s.to ?? dayStr(0)
  const points = new Map<string, SeriesPoint>()
  for (let d = Date.parse(`${bucketOf(from, q.bucket)}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += (q.bucket === 'day' ? 1 : 7) * 86_400_000) {
    const start = new Date(d).toISOString().slice(0, 10)
    points.set(start, { start, calls: 0, answered: 0, counts: {}, mean: null, needs_review: 0 })
  }
  const sums = new Map<string, number>()
  for (const c of calls) {
    const p = points.get(bucketOf(c.day, q.bucket))
    if (!p) continue
    p.calls++
    if (!sig) continue
    const a = c.answers[sig.tr]?.[sig.sig]
    if (!a || (s.version === 'current' && a.signal_version !== String(sig.q.version))) continue
    p.answered++
    p.counts[answerKey(a)] = (p.counts[answerKey(a)] ?? 0) + 1
    if (a.needs_review) p.needs_review++
    if (a.type === 'score') sums.set(p.start, (sums.get(p.start) ?? 0) + (a.value as number))
  }
  for (const p of points.values()) if (sig?.q.spec.type === 'score' && p.answered) p.mean = sums.get(p.start)! / p.answered

  const events: SeriesEvent[] = []
  const first = [...points.keys()][0] ?? from
  if (sig && sig.q.version > 1) events.push({ at: dayStr(VERSION_CHANGE_DAYS_AGO - 1), kind: 'signal_version', label: `v${sig.q.version}` })
  const seen = new Map<string, string>()
  for (const c of population()) {
    if (!c.agent_version) continue
    const k = `${c.agent_id} ${c.agent_version}`
    if (!seen.has(k) || c.day < seen.get(k)!) seen.set(k, c.day)
  }
  for (const [label, at] of seen) if (at > first && at <= to && calls.some((c) => `${c.agent_id} ${c.agent_version}` === label)) events.push({ at, kind: 'agent_version', label })
  return { signal: q.signal ?? null, type: sig?.q.spec.type ?? null, bucket: q.bucket, points: [...points.values()], events: events.filter((e) => e.at >= from && e.at <= to) }
}

/** GET /insights/breakdown (B9) */
export async function getBreakdown(s: InsightScope, q: { signal?: string; by: string }): Promise<Breakdown> {
  await wait(380)
  const calls = scoped(s)
  const sig = q.signal ? signalOf(q.signal) : null
  let groupOf: (c: PopCall) => string | null | undefined
  if (q.by === 'channel' || q.by === 'agent_id' || q.by === 'agent_version') groupOf = (c) => c[q.by as 'channel']
  else if (q.by.startsWith('meta.')) groupOf = (c) => c.metadata?.[q.by.slice(5)]
  else {
    const by = signalOf(q.by)
    groupOf = (c) => {
      const a = c.answers[by.tr]?.[by.sig]
      return a && answerKey(a)
    }
  }
  const groups = new Map<string, BreakdownGroup & { sum: number }>()
  let missing = 0
  for (const c of calls) {
    const g = groupOf(c)
    if (g == null) {
      missing++
      continue
    }
    const row = groups.get(g) ?? { key: g, answered: 0, counts: {}, mean: null, sum: 0 }
    groups.set(g, row)
    if (!sig) {
      row.answered++
      continue
    }
    const a = c.answers[sig.tr]?.[sig.sig]
    if (!a || (s.version === 'current' && a.signal_version !== String(sig.q.version))) continue
    row.answered++
    row.counts[answerKey(a)] = (row.counts[answerKey(a)] ?? 0) + 1
    if (a.type === 'score') row.sum += a.value as number
  }
  const sorted = [...groups.values()].sort((a, b) => b.answered - a.answered)
  const out = sorted.map(({ sum, ...g }) => ({ ...g, mean: sig?.q.spec.type === 'score' && g.answered ? sum / g.answered : null }))
  const other = { answered: 0, counts: {} as Record<string, number> }
  for (const g of out.slice(20)) {
    other.answered += g.answered
    for (const [k, n] of Object.entries(g.counts)) other.counts[k] = (other.counts[k] ?? 0) + n
  }
  return { signal: q.signal ?? null, by: q.by, groups: out.slice(0, 20), other, missing }
}

/** GET /calls/export.csv (B36): every conversation in scope, like the upload export plus channel and metadata. */
export async function exportCalls(s: InsightScope, filename: string): Promise<void> {
  await wait(400)
  const calls = scoped(s)
  const names = activeSignals(store.filter((c) => c.active).map((c) => c.name)).map((q) => `${q.tracker}.${q.name}`)
  const metaKeys = [...new Set(calls.flatMap((c) => Object.keys(c.metadata ?? {})))]
  saveCsv([
    ['call_id', 'external_id', 'channel', 'agent_id', 'agent_version', 'started_at', ...metaKeys.map((k) => `meta.${k}`), ...names.flatMap((n) => [n, `${n}_confidence`, `${n}_needs_review`])],
    ...calls.map((c) => [
      c.call_id, c.external_id, c.channel, c.agent_id, c.agent_version, c.started_at, ...metaKeys.map((k) => c.metadata?.[k]),
      ...names.flatMap((n) => {
        const [t, q] = n.split('.')
        const a = c.answers[t]?.[q]
        return a ? [a.value, a.confidence.toFixed(3), a.needs_review] : ['', '', '']
      }),
    ]),
  ], filename)
}

// ── Dashboards (B35) ───────────────────────────────────────────────────────────
// Kept in localStorage, unlike the rest of the mock, so a dashboard you build survives a reload.

const dashKey = (project: string) => `mock-dashboards:${project}`
const now = () => new Date().toISOString()
const SEED: Dashboard[] = FRESH ? [] : [{
  id: 'weekly-overview',
  name: 'Weekly overview',
  description: 'The numbers the clinic team checks every Monday.',
  params: 'range=30',
  created_at: dayStr(6) + 'T09:00:00Z',
  updated_at: dayStr(1) + 'T09:00:00Z',
  widgets: [
    { id: 'w1', kind: 'kpi', metric: 'conversations', size: 1 },
    { id: 'w2', kind: 'kpi', metric: 'experience.asked_for_human', value: 'yes', size: 1 },
    { id: 'w3', kind: 'kpi', metric: 'outcome.call_outcome', value: 'booked', size: 1 },
    { id: 'w4', kind: 'line', metric: 'experience.asked_for_human', value: 'yes', size: 2 },
    { id: 'w5', kind: 'donut', metric: 'outcome.call_outcome', size: 1 },
    { id: 'w6', kind: 'compare', metric: 'outcome.call_outcome', by: 'channel', size: 2 },
    { id: 'w7', kind: 'column', metric: 'experience.frustration', size: 1 },
    { id: 'w8', kind: 'heatmap', metric: 'experience.frustration', by: 'outcome.call_outcome', size: 3 },
  ],
}]

function readDashboards(project = currentId): Dashboard[] {
  try {
    const raw = localStorage.getItem(dashKey(project))
    if (raw) return JSON.parse(raw) as Dashboard[]
  } catch {
    // Storage blocked or bad JSON: start from the seed.
  }
  return project === SAMPLE_PROJECT ? structuredClone(SEED) : []
}
function writeDashboards(ds: Dashboard[]) {
  try {
    localStorage.setItem(dashKey(currentId), JSON.stringify(ds))
  } catch {
    // Not saved across reloads; fine for a mock.
  }
  memo = ds
}
let memo: Dashboard[] | undefined
const dashboards = () => (memo ??= readDashboards())

function checkDashboard(d: DashboardIn) {
  if (!d.name.trim()) throw bad('A dashboard needs a name')
  if (d.name.length > 80) throw bad('Keep the name under 80 characters')
  if (d.widgets.length > 40) throw bad('A dashboard holds at most 40 charts')
}

export async function listDashboards(): Promise<Dashboard[]> {
  await wait(200)
  return structuredClone([...dashboards()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
}

export async function getDashboard(id: string): Promise<Dashboard> {
  await wait(200)
  const d = dashboards().find((x) => x.id === id)
  if (!d) throw new ApiError('Dashboard not found', [], 404)
  return structuredClone(d)
}

export async function createDashboard(d: DashboardIn): Promise<Dashboard> {
  await wait(250)
  checkDashboard(d)
  const base = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard'
  let id = base
  for (let i = 2; dashboards().some((x) => x.id === id); i++) id = `${base}-${i}`
  const out: Dashboard = { ...structuredClone(d), id, created_at: now(), updated_at: now() }
  writeDashboards([...dashboards(), out])
  return structuredClone(out)
}

export async function saveDashboard(id: string, d: DashboardIn): Promise<Dashboard> {
  await wait(150)
  checkDashboard(d)
  const cur = dashboards().find((x) => x.id === id)
  if (!cur) throw new ApiError('Dashboard not found', [], 404)
  const out: Dashboard = { ...cur, ...structuredClone(d), updated_at: now() }
  writeDashboards(dashboards().map((x) => (x.id === id ? out : x)))
  return structuredClone(out)
}

export async function deleteDashboard(id: string): Promise<void> {
  await wait(150)
  if (!dashboards().some((x) => x.id === id)) throw new ApiError('Dashboard not found', [], 404)
  writeDashboards(dashboards().filter((x) => x.id !== id))
}

// ── Projects (B37) ─────────────────────────────────────────────────────────────
// Each project swaps in its own trackers, uploads, overlap answers and dashboards. The sample
// conversations belong to the first project only. Projects you create, and their trackers, are
// kept in localStorage. Pay as you go allows 5, Pro 25 (?plan=pro; see Billing).

const SAMPLE_PROJECT = 'clinic-bookings'
const limitOf = (p: Account['plan']) => (p === 'payg' ? 5 : 25)
const PROJECTS_KEY = 'mock-projects'

interface Space { meta: Omit<Project, 'counts'>; store: StoredTracker[]; uploads: MockUpload[]; overlap: Map<string, boolean> }
const spaces = new Map<string, Space>()
let currentId = SAMPLE_PROJECT
spaces.set(SAMPLE_PROJECT, {
  meta: FRESH
    ? { id: SAMPLE_PROJECT, name: 'My first project', description: null, created_at: '2026-09-20T09:00:00Z' }
    : { id: SAMPLE_PROJECT, name: 'Clinic bookings', description: 'Calls and chats on Sunrise Clinic’s booking line.', created_at: '2026-09-20T09:00:00Z' },
  store, uploads, overlap: overlapAnswers,
})
try {
  for (const x of JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]') as { meta: Space['meta']; store: StoredTracker[] }[]) {
    spaces.set(x.meta.id, { meta: x.meta, store: x.store, uploads: [], overlap: new Map() })
  }
} catch {
  // Nothing saved, or storage blocked.
}

function saveSpaces() {
  spaces.get(currentId)!.store = store
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([...spaces.values()].filter((x) => x.meta.id !== SAMPLE_PROJECT).map((x) => ({ meta: x.meta, store: x.store }))))
  } catch {
    // Not kept across reloads.
  }
}
addEventListener('pagehide', saveSpaces)

export function setProject(id: string | null) {
  const next = id && spaces.has(id) ? id : SAMPLE_PROJECT
  if (next === currentId) return
  Object.assign(spaces.get(currentId)!, { store, uploads, overlap: overlapAnswers })
  const s = spaces.get(next)!
  store = s.store
  uploads = s.uploads
  overlapAnswers = s.overlap
  currentId = next
  memo = undefined
  saveSpaces()
}

function projectOut(x: Space): Project {
  const st = x.meta.id === currentId ? store : x.store
  const ups = x.meta.id === currentId ? uploads : x.uploads
  const sample = x.meta.id === SAMPLE_PROJECT && !FRESH ? POP_SIZE : 0
  return {
    ...x.meta,
    counts: {
      trackers: st.length,
      signals: st.reduce((a, t) => a + t.signals.length, 0),
      conversations: sample + ups.reduce((a, u) => a + u.calls.length, 0),
      dashboards: x.meta.id === currentId ? dashboards().length : readDashboards(x.meta.id).length,
    },
  }
}

export async function getAccount(): Promise<Account> {
  await wait(150)
  const plan = bill().plan
  return { name: workspace().name, plan, project_limit: limitOf(plan), projects: spaces.size }
}

export async function listProjects(): Promise<Project[]> {
  await wait(200)
  return [...spaces.values()].map(projectOut)
}

function checkProject(p: ProjectIn, id?: string) {
  const name = p.name.trim()
  if (!name) throw bad('A project needs a name')
  if (name.length > 60) throw bad('Keep the name to 60 characters or fewer')
  if ((p.description ?? '').length > 200) throw bad('Keep the description to 200 characters or fewer')
  if ([...spaces.values()].some((x) => x.meta.id !== id && x.meta.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError(`You already have a project called ${name}`, [`You already have a project called ${name}`], 409)
  }
}

export async function createProject(p: ProjectIn): Promise<Project> {
  await wait(300)
  const plan = bill().plan
  if (spaces.size >= limitOf(plan)) {
    const msg = `${plan === 'payg' ? 'Pay as you go' : 'Pro'} includes ${limitOf(plan)} projects, and you're using all of them. Delete one${plan === 'payg' ? ', or start Pro for more' : ''}.`
    throw new ApiError(msg, [msg], 402)
  }
  checkProject(p)
  const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
  let id = base
  for (let i = 2; spaces.has(id); i++) id = `${base}-${i}`
  const x: Space = { meta: { id, name: p.name.trim(), description: p.description?.trim() || null, created_at: new Date().toISOString() }, store: [], uploads: [], overlap: new Map() }
  spaces.set(id, x)
  saveSpaces()
  return projectOut(x)
}

export async function updateProject(id: string, p: ProjectIn): Promise<Project> {
  await wait(200)
  const x = spaces.get(id)
  if (!x) throw new ApiError('Project not found', [], 404)
  checkProject(p, id)
  x.meta = { ...x.meta, name: p.name.trim(), description: p.description?.trim() || null }
  saveSpaces()
  return projectOut(x)
}

export async function deleteProject(id: string): Promise<void> {
  await wait(300)
  if (!spaces.has(id)) throw new ApiError('Project not found', [], 404)
  if (spaces.size === 1) throw new ApiError('This is your only project. Create another before deleting it.', [], 409)
  if (id === currentId) setProject([...spaces.keys()].find((k) => k !== id)!)
  spaces.delete(id)
  try {
    localStorage.removeItem(dashKey(id))
    localStorage.removeItem(threadKey(id))
  } catch {
    // Fine.
  }
  saveSpaces()
}

export async function listTrackersIn(project: string): Promise<Tracker[]> {
  await wait(200)
  const x = spaces.get(project)
  if (!x) throw new ApiError('Project not found', [], 404)
  return structuredClone((project === currentId ? store : x.store).map((c) => trackerOut(c)))
}

/** POST /trackers/import?from_project=…&trackers=…: the other project's trackers as an import file. */
export async function importTrackersFrom(from: string, trackers: string[], opts: { dryRun: boolean; onConflict: OnConflict }): Promise<ImportResult> {
  const src = spaces.get(from)
  if (!src) throw new ApiError('Project not found', [], 404)
  if (from === currentId) throw bad('Pick a different project to copy from')
  const items = src.store.filter((t) => trackers.includes(t.name)).map((t) => ({
    name: t.name, description: t.description ?? undefined, run_if: t.run_if ?? undefined, signals: t.signals.filter((q) => q.active).map((q) => q.spec),
  }))
  if (!items.length) throw bad('Pick at least one tracker to copy')
  return importTrackers(new File([JSON.stringify(items)], `${src.meta.name}.json`), opts)
}

// ── alteria (B38) ──────────────────────────────────────────────────────────────
// The real one is an LLM on the backend. The mock gets close enough to try the flows: it
// splits pasted text into conversations and turns, maps a goal's keywords to trackers, and
// reads a question's wording for its type and options.

const AGENT = /\b(agent|bot|ai|assistant|rep|support|advisor|operator|receptionist|staff|sales)\b/i
const CALLER = /\b(caller|customer|user|client|patient|lead|visitor|guest|buyer)\b/i

export async function alteriaConversations(input: { text?: string; file?: File }): Promise<AlteriaConversations> {
  await wait(1400)
  const text = (input.text ?? (input.file ? await input.file.text() : '')).replace(/\r/g, '').trim()
  if (!text) throw bad('Paste some transcripts, or choose a file')
  // Already the right JSON? Pass it through.
  try {
    const doc = JSON.parse(text)
    const rows = Array.isArray(doc) ? doc : doc?.calls
    if (Array.isArray(rows) && rows.every((r) => r && typeof r === 'object' && 'transcript' in r)) return { calls: rows as CallDraft[], warnings: ['This was already in the right shape, so nothing changed.'] }
  } catch {
    // Not JSON: read it as text.
  }
  const blocks = text.split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n|\n{3,}|\n(?=(?:call|chat|conversation|transcript)\s*#?\s*[\w-]+\s*:?\s*\n)/i).map((b) => b.trim()).filter(Boolean)
  const calls: CallDraft[] = []
  const warnings: string[] = []
  blocks.forEach((b, i) => {
    let lines = b.split('\n').map((l) => l.trim()).filter(Boolean)
    let external_id: string | undefined
    const head = /^(?:call|chat|conversation|transcript)\s*#?\s*([\w-]+)\s*:?\s*$/i.exec(lines[0] ?? '') ?? /^id\s*[:=]\s*([\w-]+)$/i.exec(lines[0] ?? '')
    if (head) {
      external_id = head[1]
      lines = lines.slice(1)
    }
    const turns: { speaker: string; text: string }[] = []
    for (const l of lines) {
      const m = /^\[?(?:\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?([A-Za-z][\w .'()-]{0,30}?)\s*[:：]\s+(.+)$/.exec(l)
      if (m) {
        const who = m[1].trim()
        turns.push({ speaker: AGENT.test(who) ? 'agent' : CALLER.test(who) ? 'caller' : who.toLowerCase(), text: m[2].trim() })
      } else if (turns.length) turns[turns.length - 1].text += ` ${l}`
      else turns.push({ speaker: 'unknown', text: l })
    }
    if (!turns.length) return
    if (turns.every((t) => t.speaker === 'unknown')) {
      warnings.push(`Conversation ${i + 1} had no speaker labels, so it's kept as plain text.`)
      calls.push({ ...(external_id ? { external_id } : {}), transcript: turns.map((t) => t.text).join('\n') })
    } else calls.push({ ...(external_id ? { external_id } : {}), transcript: turns })
  })
  if (!calls.length) throw bad('alteria couldn’t find any conversations in that. Put each speaker’s turn on its own line, like “agent: Hello”.')
  const named = [...new Set(calls.flatMap((c) => (Array.isArray(c.transcript) ? c.transcript.map((t) => t.speaker) : [])))].filter((x) => !['agent', 'caller', 'unknown'].includes(x))
  if (named.length) warnings.push(`Speakers kept as written: ${named.join(', ')}. Rename them to agent and caller if that's who they are.`)
  return { calls, warnings }
}

const choiceOf = (opts: [string, string][]): Record<string, string> => Object.fromEntries([...opts, ['other', 'None of the above']])

export async function alteriaTrackers(goal: string, existing: string[]): Promise<AlteriaTrackers> {
  await wait(1600)
  const g = goal.toLowerCase()
  if (g.trim().length < 8) throw bad('Tell alteria a little more: what the conversations are, and what you want to find out')
  const has = (re: RegExp) => re.test(g)
  const out: TrackerDraft[] = []

  const outcome = has(/book|appoint|reserv|schedul/) ? choiceOf([['booked', 'An appointment or booking was made'], ['rescheduled', 'An existing booking was moved'], ['declined', 'They decided not to book'], ['no_answer', 'Nobody answered, or the line dropped']])
    : has(/sale|sell|buy|purchas|deal|convert|lead|demo/) ? choiceOf([['purchased', 'They bought or signed up'], ['interested', 'Interested; agreed to a next step'], ['not_interested', 'They said no'], ['callback', 'Asked to be contacted later']])
    : has(/support|issue|ticket|resolv|complain|problem|help/) ? choiceOf([['resolved', 'The problem was solved in the conversation'], ['escalated', 'Handed to another team or a person'], ['unresolved', 'It ended without a fix']])
    : choiceOf([['goal_met', 'The conversation achieved what it was for'], ['partly_met', 'Some progress, not all the way'], ['not_met', 'It didn’t achieve its purpose']])
  const outcomeSignals: SignalSpec[] = [{ name: 'outcome', type: 'choice', instructions: 'How did the conversation end? Pick the one that fits best. If none fits, choose Other.', criteria: outcome }]
  if (has(/why|reason|declin|lost|churn|cancel|objection/)) {
    outcomeSignals.push({ name: 'main_reason', type: 'choice', instructions: 'If they said no or left, what was the main reason they gave? If they didn’t give one, choose Not stated.', criteria: choiceOf([['price', 'Too expensive, or cheaper elsewhere'], ['timing', 'Not the right time'], ['competitor', 'Went with someone else'], ['not_needed', 'Doesn’t need it any more'], ['not_stated', 'No reason given']]) })
  }
  out.push({ name: 'outcome', description: 'How the conversation ended', signals: outcomeSignals })

  const exp: SignalSpec[] = []
  if (has(/frustrat|angry|upset|annoy|sentiment|mood|experience|happy|satisf|tone|feel/)) {
    exp.push({ name: 'frustration', type: 'score', instructions: 'How frustrated was the customer by the end of the conversation?', criteria: ['Calm: polite or neutral throughout', 'Irritated: some impatience, still cooperative', 'Frustrated: repeated complaints or a raised tone', 'Angry: hostile, or threatens to complain or leave'] })
  }
  if (has(/human|person|escalat|transfer|bot|agent|ai\b/)) {
    exp.push({ name: 'asked_for_human', type: 'yes_no', instructions: 'Did the customer ask to speak to a person instead of the bot or agent?' })
  }
  if (exp.length) out.push({ name: 'experience', description: 'How the customer felt about the conversation', signals: exp })

  const comp: SignalSpec[] = []
  if (has(/complian|policy|script|disclos|legal|regulat|consent|misstat|promise|wrong/)) {
    comp.push({ name: 'misstated_policy', type: 'yes_no', instructions: 'Did the agent state a price, policy or promise that is wrong or not allowed? Only answer yes when it’s clear from what was said.' })
    comp.push({ name: 'followed_script', type: 'score', instructions: 'How closely did the agent follow the expected steps (greeting, checks, clear next step)?', criteria: ['Missed most: skipped key steps', 'Partly: some steps missing', 'Mostly: small gaps', 'Fully: every step covered'] })
  }
  if (has(/competitor|rival|alternative/)) comp.push({ name: 'competitor_mentioned', type: 'yes_no', instructions: 'Did the customer mention a competitor or another provider?' })
  if (comp.length) out.push({ name: 'quality', description: 'How well the agent handled it', signals: comp })

  // Names already in the project get the use case in front, so nothing is skipped on import.
  const taken = new Set(existing)
  const domain = has(/book|appoint|reserv|schedul/) ? 'booking' : has(/sale|sell|buy|purchas|deal|convert|lead|demo/) ? 'sales' : has(/support|issue|ticket|resolv|complain|problem|help/) ? 'support' : 'new'
  const renamed: string[] = []
  for (const t of out) {
    if (!taken.has(t.name)) continue
    let n = `${domain}_${t.name}`
    for (let i = 2; taken.has(n); i++) n = `${domain}_${t.name}_${i}`
    renamed.push(`${title(t.name)} → ${title(n)}`)
    t.name = n
  }
  const notes = ['Drafted from your description. Check the options match the words your customers use before importing.']
  if (renamed.length) notes.push(`You already have trackers with some of these names, so they're renamed: ${renamed.join(', ')}.`)
  if (out.length === 1) notes.push('Mention feelings, escalation, compliance or competitors in your goal and alteria will add trackers for those too.')
  return { trackers: out, notes }
}

const STOP = new Set(['did', 'does', 'do', 'was', 'were', 'is', 'are', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'how', 'what', 'which', 'why', 'they', 'their', 'caller', 'customer', 'agent', 'call', 'conversation', 'this', 'that', 'it', 'by', 'end', 'any', 'and', 'or', 'has', 'have', 'there', 'can', 'will', 'be'])

export async function alteriaSignal(text: string, tracker: string, type?: string): Promise<AlteriaSignal> {
  await wait(1100)
  void tracker
  const q = text.trim().replace(/\s+/g, ' ')
  if (q.length < 6) throw bad('Write the question you want answered, like “Did the caller ask for a refund?”')
  const lower = q.toLowerCase()
  const words = lower.replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w && !STOP.has(w))
  const name = (words.slice(0, 4).join('_') || 'signal').replace(/^[^a-z]+/, '').slice(0, 64) || 'signal'
  const ask = q.charAt(0).toUpperCase() + q.slice(1).replace(/[.?!]*$/, '?')
  const notes: string[] = []
  const listed = /(?:[:(]\s*|\bbetween\s+|\beither\s+)([^?)]+?)(?:\)|\?|$)/.exec(q)?.[1]
  const options = listed?.split(/\s*,\s*|\s+or\s+|\s*\/\s*/).map((o) => o.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '_')).filter((o) => /^[a-z]/.test(o)).slice(0, 12)

  let kind = type as SignalSpec['type'] | undefined
  if (!kind) {
    kind = options && options.length >= 2 ? 'choice'
      : /^(did|does|do|was|were|is|are|has|have|had|can|could|will|would|should)\b/.test(lower) ? 'yes_no'
      : /^how (much|many|frustrat|satisf|happy|angry|upset|likely|well|confident|polite|clear|interested|urgent|calm)|\b(scale|rate|rating|score|level)\b/.test(lower) ? 'score'
      : 'choice'
  }
  let spec: SignalSpec
  if (kind === 'yes_no') spec = { name, type: 'yes_no', instructions: `${ask} Answer yes only when the conversation shows it clearly.` }
  else if (kind === 'score') {
    const adj = /how (\w+)/.exec(lower)?.[1] ?? 'strong'
    spec = { name, type: 'score', instructions: `${ask} Judge the conversation as a whole.`, criteria: [`Not at all: no sign of it`, `A little: brief or mild`, `Clearly: shows it more than once`, `Very ${adj}: it dominates the conversation`] }
    notes.push('The levels are generic. Describe each in your customers’ words.')
  } else {
    const opts = options && options.length >= 2 ? options
      : /why|reason/.test(lower) ? ['price', 'timing', 'competitor', 'not_stated']
      : /end|outcome|result/.test(lower) ? ['succeeded', 'declined', 'follow_up']
      : ['first_option', 'second_option']
    if (!(options && options.length >= 2) && !/why|reason|end|outcome|result/.test(lower)) notes.push('alteria couldn’t tell the options from the question. Replace the placeholders with yours.')
    spec = { name, type: 'choice', instructions: `${ask} Pick the one that fits best. If none fits, choose Other.`, criteria: Object.fromEntries([...opts.filter((o) => o !== 'other').map((o) => [o, title(o)]), ['other', 'None of the above']]) }
  }
  return { signal: spec, notes }
}

// ── Billing (B40) ──────────────────────────────────────────────────────────────


// ── Ask alteria (B39) ──────────────────────────────────────────────────────────
// The real one retrieves across transcripts and answers with an LLM. The mock recognises the
// sample project's usual questions and answers them from the same data Insights uses, with a
// chart and the conversations behind it. Anything else gets an honest "track it as a signal".

const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
const num = (n: number) => n.toLocaleString('en-US')
const val = (c: CallResult, ref: string) => {
  const [t, q] = ref.split('.')
  const a = c.answers[t]?.[q]
  return a ? (a.type === 'score' ? Math.round(a.value as number) : String(a.value)) : undefined
}
const w = (kind: Widget['kind'], metric: string, extra: Partial<Widget> = {}): Widget => ({ id: 'ask', kind, metric, size: 2, ...extra })

/** B39 + B41: answers, and keeps the chat. No `threadId` starts a new one, titled from the question. */
export async function askAlteria(question: string, s: InsightScope, threadId?: string, draft?: DashboardDraft): Promise<AlteriaAnswer> {
  await wait(900)
  const all = readThreads()
  let t = threadId ? all.find((x) => x.id === threadId) : undefined
  if (threadId && !t) throw new ApiError('Chat not found', [], 404)
  if (t && !t.mine) throw new ApiError(`Only ${t.owner!.name} can ask in this chat. Continue in a copy to ask more.`, [], 403)
  spendAskTrial()
  if (!t) {
    t = newThread(titleFor(question))
    all.push(t)
  }
  const answer = answerOf(question, s, draft ?? t.draft ?? undefined)
  pushTurn(t, question, s, answer)
  if (answer.dashboard) t.draft = answer.dashboard
  writeThreads(all)
  return { ...answer, thread_id: t.id, message_id: t.messages.at(-1)!.id, title: t.title }
}

function answerOf(question: string, s: InsightScope, draft?: DashboardDraft): AlteriaAnswer {
  const q = question.toLowerCase()
  const calls = scoped(s)
  const n = calls.length
  const board = dashboardIntent(q, draft)
  if (board) return board
  if (!n) {
    return { text: 'There are no analysed conversations in this project for this period yet. Analyse some on **Analyse calls**, or widen the time range, then ask again.', citations: [], follow_ups: [] }
  }
  const hasSig = (ref: string) => calls.some((c) => val(c, ref) !== undefined)
  const cite = (pred: (c: PopCall) => boolean, why: (c: PopCall) => string, k = 3) =>
    calls.filter(pred).slice(0, k).map((c) => ({ call_id: c.call_id, external_id: c.external_id, why: why(c) }))
  const tally = (list: PopCall[], ref: string) => {
    const m = new Map<string, number>()
    for (const c of list) { const v = val(c, ref); if (v !== undefined) m.set(String(v), (m.get(String(v)) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }

  if (/declin|why .*(not|n't)|reason|lost|objection|say no/.test(q) && hasSig('outcome.decline_reason')) {
    const declined = calls.filter((c) => val(c, 'outcome.call_outcome') === 'declined')
    const reasons = tally(declined, 'outcome.decline_reason').filter(([k]) => k !== 'not_applicable')
    const byCh = ['voice_agent', 'call', 'chat'].map((ch) => {
      const d = declined.filter((c) => c.channel === ch)
      return [ch, share(d.filter((c) => val(c, 'outcome.decline_reason') === 'price').length, d.length)] as const
    }).sort((a, b) => b[1] - a[1])[0]
    return {
      text: `**${num(declined.length)} of ${num(n)}** conversations (${share(declined.length, n)}%) ended with the customer saying no. The reasons they gave:\n${reasons.slice(0, 4).map(([k, c]) => `- **${title(k)}**: ${share(c, declined.length)}%`).join('\n')}\n\nPrice comes up most on **${byCh[0] === 'voice_agent' ? 'voice agent calls' : byCh[0] === 'call' ? 'front-desk calls' : 'chats'}** (${byCh[1]}% of their declines).`,
      chart: { widget: w('bar', 'outcome.decline_reason', { title: 'Why they declined' }), where: ['outcome.call_outcome:declined'] },
      citations: cite((c) => val(c, 'outcome.call_outcome') === 'declined' && val(c, 'outcome.decline_reason') === 'price', () => 'Declined · price'),
      follow_ups: ['Which rep has the most declines?', 'Did declines change after agent v13?', 'How frustrated were people who declined?'],
    }
  }
  if (/v1[23]|version|release|since|after .*(change|update)|what changed/.test(q) && hasSig('experience.asked_for_human')) {
    const rate = (v: string) => {
      const l = calls.filter((c) => c.agent_version === v)
      return { human: share(l.filter((c) => val(c, 'experience.asked_for_human') === 'yes').length, l.length), booked: share(l.filter((c) => val(c, 'outcome.call_outcome') === 'booked').length, l.length), n: l.length }
    }
    const a = rate('v12'), b = rate('v13')
    return {
      text: `Since **v13** of the voice agent went live, callers ask for a person more often: **${b.human}%** of v13 calls, against **${a.human}%** on v12 (${num(b.n)} and ${num(a.n)} calls). Bookings moved from ${a.booked}% to ${b.booked}%.\n\nThe v13 calls where people asked for a person mostly ended as Other, which usually means the bot didn't understand the request.`,
      chart: { widget: w('compare', 'experience.asked_for_human', { by: 'agent_version', title: 'Asked for a person, by agent version' }) },
      citations: cite((c) => c.agent_version === 'v13' && val(c, 'experience.asked_for_human') === 'yes', (c) => `v13 · asked for a person · ${title(String(val(c, 'outcome.call_outcome') ?? ''))}`),
      follow_ups: ['Show v13 calls that ended as Other', 'Did v13 misstate policy less?', 'What should I change in v13?'],
    }
  }
  if (/\brep|who .*(best|most|book)|team|staff|meera|arjun|kavya|rohan/.test(q) && calls.some((c) => c.metadata?.rep)) {
    const reps = [...new Set(calls.map((c) => c.metadata?.rep).filter(Boolean))] as string[]
    const rows = reps.map((r) => {
      const l = calls.filter((c) => c.metadata?.rep === r)
      return { r, booked: share(l.filter((c) => val(c, 'outcome.call_outcome') === 'booked').length, l.length), n: l.length }
    }).sort((a, b) => b.booked - a.booked)
    const low = rows[rows.length - 1]
    return {
      text: `On front-desk calls, **${rows[0].r}** books the most (${rows[0].booked}% of ${num(rows[0].n)} calls). The full list:\n${rows.map((x) => `- **${x.r}**: ${x.booked}% booked`).join('\n')}\n\n**${low.r}** books least; most of their misses end as a decline over price. Their calls are a good place to start coaching.`,
      chart: { widget: w('compare', 'outcome.call_outcome', { by: 'meta.rep', title: 'Call outcome by rep' }) },
      citations: cite((c) => c.metadata?.rep === low.r && val(c, 'outcome.call_outcome') === 'declined', (c) => `${c.metadata?.rep} · declined`),
      follow_ups: [`Why does ${low.r} lose calls?`, 'Which rep frustrates callers least?', 'Compare reps on chats too'],
    }
  }
  if (/frustrat|angry|upset|annoy|mood|unhappy|complain/.test(q) && hasSig('experience.frustration')) {
    const high = calls.filter((c) => (val(c, 'experience.frustration') as number) >= 2)
    const byOutcome = tally(high, 'outcome.call_outcome')
    return {
      text: `**${share(high.length, n)}%** of conversations (${num(high.length)}) ended with the customer frustrated or angry. They cluster in:\n${byOutcome.slice(0, 3).map(([k, c]) => `- **${title(k)}**: ${share(c, high.length)}% of them`).join('\n')}\n\nThe angriest ones usually include a request for a person that wasn't met.`,
      chart: { widget: w('heatmap', 'experience.frustration', { by: 'outcome.call_outcome', size: 3, title: 'Frustration by how it ended' }) },
      citations: cite((c) => val(c, 'experience.frustration') === 3, () => 'Angry'),
      follow_ups: ['Did frustration change after v13?', 'Which channel frustrates people most?', 'Show angry calls that still booked'],
    }
  }
  if (/human|person|escalat|transfer|real agent|speak to/.test(q) && hasSig('experience.asked_for_human')) {
    const yes = calls.filter((c) => val(c, 'experience.asked_for_human') === 'yes')
    return {
      text: `**${share(yes.length, n)}%** of conversations (${num(yes.length)} of ${num(n)}) include a request to speak to a person. It's highest with the voice agent, and it rose after v13.`,
      chart: { widget: w('line', 'experience.asked_for_human', { value: 'yes', size: 3, title: 'Asked for a person, over time' }) },
      citations: cite((c) => val(c, 'experience.asked_for_human') === 'yes', (c) => `${c.channel === 'voice_agent' ? 'Voice agent' : c.channel === 'chat' ? 'Chat' : 'Call'} · asked for a person`),
      follow_ups: ['What did v13 change?', 'How did those calls end?', 'Show chats where they asked for a person'],
    }
  }
  if (/polic|misstat|complian|wrong|quote|promis/.test(q) && hasSig('compliance.agent_misstated_policy')) {
    const yes = calls.filter((c) => val(c, 'compliance.agent_misstated_policy') === 'yes')
    return {
      text: `The agent stated a policy or price wrongly in **${share(yes.length, n)}%** of conversations (${num(yes.length)}). It's rarer since v13 of the voice agent, and most common on front-desk calls.`,
      chart: { widget: w('compare', 'compliance.agent_misstated_policy', { by: 'channel', title: 'Misstated policy, by channel' }) },
      citations: cite((c) => val(c, 'compliance.agent_misstated_policy') === 'yes', (c) => `${c.channel === 'call' ? 'Front desk' : c.channel === 'chat' ? 'Chat' : 'Voice agent'} · misstated policy`),
      follow_ups: ['Which rep misstates policy most?', 'Did misstated calls still book?'],
    }
  }
  if (/how many|volume|count|channel|busiest|busy/.test(q)) {
    const by = ['voice_agent', 'call', 'chat'].map((c) => [c, calls.filter((x) => x.channel === c).length] as const)
    return {
      text: `**${num(n)} conversations** in this period:\n${by.map(([c, k]) => `- **${c === 'voice_agent' ? 'Voice agent' : c === 'call' ? 'Calls' : 'Chats'}**: ${num(k)} (${share(k, n)}%)`).join('\n')}`,
      chart: { widget: w('line', CONVERSATIONS_REF, { size: 3, title: 'Conversations over time' }) },
      citations: [],
      follow_ups: ['How did calls end, by channel?', 'Which channel declines most?'],
    }
  }
  // Nothing tracked answers it: say so, and offer to track it.
  const booked = share(calls.filter((c) => val(c, 'outcome.call_outcome') === 'booked').length, n)
  return {
    text: `None of your signals answers that directly, so I can't count it across ${num(n)} conversations yet. Track it as a signal, and every conversation from now on gets an answer you can chart.\n\nFor context: ${hasSig('outcome.call_outcome') ? `${booked}% of conversations in this period ended booked` : `there are ${num(n)} conversations in this period`}.`,
    citations: [],
    follow_ups: ['Why do customers decline?', 'What changed after v13?', 'Which rep books the most?'],
    suggest_signal: question,
  }
}
const CONVERSATIONS_REF = 'conversations'

// Dashboards by chat: "build a dashboard for…" drafts one; while a draft is open, "add …" and
// "remove …" change it. Built from the project's own signals, like the UI's templates.

function signalRefs() {
  const qs = activeSignals(store.filter((c) => c.active).map((c) => c.name))
  const ref = (x: Signal) => `${x.tracker}.${x.name}`
  return {
    yes: qs.filter((x) => x.spec.type === 'yes_no').map(ref),
    choice: qs.filter((x) => x.spec.type === 'choice' && !store.find((t) => t.name === x.tracker)?.run_if).map(ref),
    score: qs.filter((x) => x.spec.type === 'score').map(ref),
    all: qs.map(ref),
  }
}
let wid = 0
const bw = (kind: Widget['kind'], metric: string, extra: Partial<Widget> = {}): Widget => ({ id: `al${++wid}`, kind, metric, size: kind === 'kpi' || kind === 'bar' || kind === 'column' || kind === 'donut' ? 1 : 2, ...extra })

/** Words → the charts they ask for. Used for new drafts and for "add …". */
function chartsFor(q: string): Widget[] {
  const r = signalRefs()
  const out: Widget[] = []
  const by = /\brep|team|coach|people|staff/.test(q) ? 'meta.rep' : /channel|chat|call vs/.test(q) ? 'channel' : /version|release|agent|v1[23]/.test(q) ? 'agent_version' : undefined
  if (/volume|how many|conversations/.test(q)) out.push(bw('kpi', 'conversations'), bw('line', 'conversations', { size: 2 }))
  if (/human|person|escalat/.test(q) && r.yes.includes('experience.asked_for_human')) out.push(bw('kpi', 'experience.asked_for_human', { value: 'yes' }), bw('line', 'experience.asked_for_human', { value: 'yes' }))
  if (/frustrat|angry|mood|experience|sentiment/.test(q) && r.score[0]) out.push(bw('column', r.score[0]), ...(r.choice[0] ? [bw('heatmap', r.score[0], { by: by ?? r.choice[0], size: 3 as const })] : []))
  if (/declin|reason|why|lost/.test(q) && r.all.includes('outcome.decline_reason')) out.push(bw('bar', 'outcome.decline_reason'))
  if (/outcome|book|convert|result|end/.test(q) && r.choice[0]) out.push(bw('kpi', r.choice[0], { value: 'booked' }), by ? bw('compare', r.choice[0], { by }) : bw('donut', r.choice[0]))
  if (/polic|complian|misstat/.test(q) && r.all.includes('compliance.agent_misstated_policy')) out.push(bw(by ? 'compare' : 'kpi', 'compliance.agent_misstated_policy', by ? { by } : { value: 'yes' }))
  if (by && !out.some((x) => x.by === by)) for (const m of [...r.choice.slice(0, 1), ...r.yes.slice(0, 2)]) out.push(bw('compare', m, { by }))
  return out
}

function dashboardIntent(q: string, draft?: DashboardDraft): AlteriaAnswer | undefined {
  const build = /\b(dashboard|board|report page|overview page)\b/.test(q) && /\b(build|make|create|set up|design|give me|new)\b/.test(q)
  if (draft && !build && /^(add|also|include|remove|drop|delete|rename|call it|make it)|\b(add|remove|drop)\b/.test(q)) {
    let widgets = [...draft.widgets]
    let name = draft.name
    const said: string[] = []
    const rn = /(?:rename|call) (?:it |this )?(?:to )?["“]?([^"”]+)["”]?$/.exec(q)
    if (rn) { name = rn[1].trim().replace(/^./, (c) => c.toUpperCase()); said.push(`renamed it **${name}**`) }
    if (/\b(remove|drop|delete)\b/.test(q)) {
      const words = q.replace(/\b(remove|drop|delete|the|chart|charts|please)\b/g, '').trim().split(/\s+/).filter((x) => x.length > 2)
      const before = widgets.length
      widgets = widgets.filter((x) => !words.some((wd) => `${x.metric} ${x.by ?? ''} ${x.kind}`.replace(/[._]/g, ' ').includes(wd)))
      if (widgets.length < before) said.push(`removed ${before - widgets.length === 1 ? 'a chart' : `${before - widgets.length} charts`}`)
    }
    if (/\b(add|also|include)\b/.test(q)) {
      const add = chartsFor(q).filter((x) => !widgets.some((y) => y.kind === x.kind && y.metric === x.metric && y.by === x.by))
      widgets.push(...add)
      if (add.length) said.push(`added ${add.length === 1 ? 'a chart' : `${add.length} charts`}`)
    }
    return {
      text: said.length ? `Done: I ${said.join(' and ')}. It has ${widgets.length} charts now. Save it when it looks right, or keep changing it.` : 'I couldn’t match that to a chart. Try “add frustration by rep”, “add decline reasons”, or “remove the donut”.',
      citations: [], follow_ups: ['Add decline reasons', 'Add conversations over time', 'Remove the donut'],
      dashboard: { name, description: draft.description, widgets },
    }
  }
  if (!build) return undefined
  const r = signalRefs()
  if (!r.all.length) return { text: 'This project has no signals yet, so there’s nothing to chart. Set up a tracker first, and I’ll build a dashboard from it.', citations: [], follow_ups: [] }
  let widgets = chartsFor(q)
  let name = 'Overview'
  if (/version|release|agent|v1[23]/.test(q)) name = 'Agent versions'
  else if (/\brep|team|coach/.test(q)) name = 'Team performance'
  else if (/channel/.test(q)) name = 'Channels'
  else if (/frustrat|experience|sentiment/.test(q)) name = 'Customer experience'
  else if (/declin|lost|reason/.test(q)) name = 'Why we lose them'
  if (widgets.length < 3) {
    widgets = [
      bw('kpi', 'conversations'),
      ...r.yes.slice(0, 2).map((m) => bw('kpi', m, { value: 'yes' })),
      ...r.choice.slice(0, 1).map((m) => bw('bar', m)),
      ...r.yes.slice(0, 1).map((m) => bw('line', m, { value: 'yes' })),
      ...r.score.slice(0, 1).map((m) => bw('column', m)),
      ...(r.score[0] && r.choice[0] ? [bw('heatmap', r.score[0], { by: r.choice[0], size: 3 })] : []),
      ...widgets,
    ].slice(0, 9)
  }
  return {
    text: `Here’s a draft **${name}** dashboard with ${widgets.length} charts, built from this project’s signals. Change it by telling me what to add or remove, remove any chart below, then save it.`,
    citations: [],
    follow_ups: ['Add frustration by rep', 'Add decline reasons', 'Rename it to “Monday review”'],
    dashboard: { name, description: `Built with alteria from: “${q.slice(0, 120)}”`, widgets },
  }
}

// ── Saved chats (B41) ──────────────────────────────────────────────────────────
// In localStorage per project, like dashboards, so chats survive a reload.

const threadKey = (project: string) => `mock-threads:${project}`
const mid = () => `m-${Math.random().toString(36).slice(2, 10)}`

/** What the backend's simple tier would write: the question, shortened, without the question mark. */
function titleFor(question: string) {
  const t = question.trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '')
  const cut = t.length > 44 ? `${t.slice(0, 44).replace(/\s+\S*$/, '')}…` : t
  return cut.charAt(0).toUpperCase() + cut.slice(1)
}

function pushTurn(t: AskThread, question: string, scope: InsightScope, answer: AlteriaAnswer, at = now()) {
  t.messages.push({ id: mid(), role: 'user', text: question, scope, created_at: at }, { id: mid(), role: 'alteria', text: answer.text, answer, scope, created_at: at })
  t.message_count = t.messages.length
  t.preview = question.slice(0, 120)
  t.updated_at = at
}

const newThread = (title: string, at = now(), owner: Person = person(me())): AskThread => ({
  id: `t-${Math.random().toString(36).slice(2, 10)}`, title, pinned: false, created_at: at, updated_at: at, message_count: 0, preview: null,
  messages: [], draft: null, saved_dashboard_id: null, owner, mine: owner.id === me().id, shared_at: null, copied_from: null,
})

function seedThreads(): AskThread[] {
  const scope: InsightScope = { from: dayStr(29), to: dayStr(0) }
  const seeds: [string, number, boolean][] = [['Why do customers decline?', 2, true], ['Which rep books the most?', 0, false], ['What changed after agent v13?', 9, false]]
  return seeds.map(([q, ago, pinned], i) => {
    const at = new Date(Date.now() - ago * 86_400_000 - (i + 1) * 3_600_000).toISOString()
    const t: AskThread = { ...newThread(titleFor(q), at), id: `seed-${i + 1}`, pinned }
    pushTurn(t, q, scope, answerOf(q, scope), at)
    return t
  })
}

/** B43: chats teammates shared with the project, so the sidebar's Shared group and read-only view show. */
function seedShared(): AskThread[] {
  const scope: InsightScope = { from: dayStr(29), to: dayStr(0) }
  const [, priya, daniel] = team().members
  const seeds: [string, string[], Member, number][] = [
    ['Where do reschedules come from?', ['Where do reschedules come from?', 'Which rep has the most?'], priya, 1],
    ['Agent quality dashboard', ['Build me a dashboard for agent quality', 'Add frustration by rep'], daniel, 3],
  ]
  return seeds.map(([title, qs, by, ago], i) => {
    const at = new Date(Date.now() - ago * 86_400_000 - 2 * 3_600_000).toISOString()
    const t: AskThread = { ...newThread(title, at, person(by)), id: `shared-${i + 1}`, shared_at: at }
    let draft: DashboardDraft | undefined
    for (const q of qs) {
      const a = answerOf(q, scope, draft)
      if (a.dashboard) draft = t.draft = a.dashboard
      pushTurn(t, q, scope, a, at)
    }
    return t
  })
}

function readThreads(): AskThread[] {
  try {
    const raw = localStorage.getItem(threadKey(currentId))
    if (raw) return withPeople(JSON.parse(raw) as AskThread[])
  } catch {
    // Storage blocked or bad JSON: start from the seed.
  }
  const seed = currentId === SAMPLE_PROJECT && !FRESH ? [...seedThreads(), ...seedShared()] : []
  writeThreads(seed)
  return seed
}
/** Chats saved before sharing existed are the signed-in person's, and private. */
function withPeople(ts: AskThread[]): AskThread[] {
  const self = person(me())
  let seeded = false
  for (const t of ts) {
    t.owner ??= self
    t.mine = t.owner.id === self.id
    t.shared_at ??= null
    t.copied_from ??= null
    seeded ||= t.id.startsWith('shared-')
  }
  // Chats kept from before B43 get the teammates' shared ones once.
  if (!seeded && currentId === SAMPLE_PROJECT && !FRESH && ts.some((t) => t.id === 'seed-1')) {
    ts.push(...seedShared())
    writeThreads(ts)
  }
  return ts
}
function writeThreads(ts: AskThread[]) {
  try {
    localStorage.setItem(threadKey(currentId), JSON.stringify(ts))
  } catch {
    // Not saved across reloads; fine for a mock.
  }
}

const summary = ({ messages: _m, draft: _d, saved_dashboard_id: _s, ...t }: AskThread): AskThreadSummary => t
const findThread = (all: AskThread[], id: string) => {
  const t = all.find((x) => x.id === id)
  if (!t) throw new ApiError('Chat not found', [], 404)
  return t
}

export async function listThreads(q?: string): Promise<AskThreadPage> {
  await wait(200)
  const needle = q?.trim().toLowerCase()
  const hit = (t: AskThread) => !needle || t.title.toLowerCase().includes(needle) || t.messages.some((m) => m.text.toLowerCase().includes(needle))
  const threads = readThreads().filter(hit).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
  return { threads: threads.map(summary), next: null }
}

export async function getThread(id: string): Promise<AskThread> {
  await wait(250)
  return structuredClone(findThread(readThreads(), id))
}

export async function updateThread(id: string, patch: AskThreadPatch): Promise<AskThreadSummary> {
  await wait(150)
  const all = readThreads()
  const t = findThread(all, id)
  if ((patch.title !== undefined || patch.draft !== undefined) && !t.mine) throw new ApiError(`Only ${t.owner!.name} can change this chat.`, [], 403)
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title || title.length > 80) throw bad('A chat name is 1 to 80 characters')
    t.title = title
  }
  if (patch.pinned !== undefined) t.pinned = patch.pinned
  if (patch.draft !== undefined) t.draft = patch.draft
  if (patch.saved_dashboard_id !== undefined) t.saved_dashboard_id = patch.saved_dashboard_id
  writeThreads(all)
  return summary(t)
}

/** Your own private chats, or any chat for an admin: a shared chat belongs to the team. */
function deleteRefusal(t: AskThread) {
  if (isAdmin()) return null
  if (!t.mine) return `Only ${t.owner!.name} or an admin can delete this chat.`
  if (t.shared_at) return 'This chat is shared with the team, so only an admin can delete it.'
  return null
}

export async function deleteThread(id: string): Promise<void> {
  await wait(200)
  const all = readThreads()
  const why = deleteRefusal(findThread(all, id))
  if (why) throw new ApiError(why, [], 403)
  writeThreads(all.filter((x) => x.id !== id))
}

const PRO_SHARE = 'Sharing chats with your team is part of Pro.'

function shareRefusal(t: AskThread) {
  if (!t.mine) return `Only ${t.owner!.name} can share this chat.`
  if (!features().share_chats) return PRO_SHARE
  if (me().role === 'viewer') return 'Viewers can’t share chats.'
  return null
}

export async function shareThread(id: string): Promise<AskThreadSummary> {
  await wait(300)
  const all = readThreads()
  const t = findThread(all, id)
  if (t.shared_at) return summary(t)
  const why = shareRefusal(t)
  if (why) throw new ApiError(why, [], why === PRO_SHARE ? 402 : 403)
  t.shared_at = now()
  writeThreads(all)
  return summary(t)
}

export async function copyThread(id: string): Promise<AskThreadSummary> {
  await wait(350)
  const all = readThreads()
  const from = findThread(all, id)
  const t: AskThread = {
    ...structuredClone(from), ...newThread(from.title),
    messages: structuredClone(from.messages), message_count: from.message_count, preview: from.preview, draft: structuredClone(from.draft), saved_dashboard_id: null,
    copied_from: { id: from.id, title: from.title, by: from.owner! },
  }
  all.push(t)
  writeThreads(all)
  return summary(t)
}

export async function bulkThreads(ids: string[], action: ThreadBulkAction): Promise<BulkResult> {
  await wait(400)
  if (action === 'share' && !features().share_chats) throw new ApiError(PRO_SHARE, [], 402)
  let all = readThreads()
  const out: BulkResult = { done: [], failed: [] }
  for (const id of ids) {
    const t = all.find((x) => x.id === id)
    const why = !t ? 'Chat not found' : action === 'delete' ? deleteRefusal(t) : action === 'share' ? (t.shared_at ? null : shareRefusal(t)) : null
    if (why) {
      out.failed.push({ id, detail: why })
      continue
    }
    if (action === 'delete') all = all.filter((x) => x.id !== id)
    else if (action === 'share') t!.shared_at ??= now()
    else t!.pinned = action === 'pin'
    out.done.push(id)
  }
  writeThreads(all)
  return out
}

// ── Billing (B40) ──────────────────────────────────────────────────────────────
// Prepaid credits, like billing.py. Off until a pay-as-you-go price is set: ?price=0.5 turns it on,
// ?pro=49 prices Pro (?pro_rate and ?pro_tokens set its rate and allowance), ?trial=5 sets the
// trial credit and ?plan=pro starts on Pro. The prices are remembered; ?prices=off forgets them.
// No settling: an upload keeps its whole hold, which is the most its calls can use.


const mockPlans = (): BillingPlan[] => {
  // B55: regional prices, a multiplier on the USD prices for the visitor's country.
  const cur = mockCurrency()
  const m = regionFor(cur.country)?.multiplier ?? 1
  const r = (n: number | null) => (n === null ? null : Math.round(n * m * 1e4) / 1e4)
  // A monthly fee is a clean local price point (₹2,449, not ₹2,443.14), as the backend will publish.
  const fee = (n: number | null) => {
    if (n === null || cur.code === 'USD') return r(n)
    const local = n * m * cur.rate
    const step = local >= 1000 ? 50 : local >= 100 ? 10 : 1
    return Math.round(((Math.ceil(local / step) * step - (step > 1 ? 1 : 0)) / cur.rate) * 1e6) / 1e6
  }
  return [
    { id: 'payg', name: 'Pay as you go', monthly_fee: 0, included_tokens: 0, price_per_million_tokens: r(prices.payg), alteria: false },
    { id: 'pro', name: 'Pro', monthly_fee: fee(prices.pro), included_tokens: prices.pro === null ? 0 : prices.proTokens, price_per_million_tokens: r(prices.proRate), alteria: true },
  ]
}
const planPrice = (id: Account['plan']) => mockPlans().find((p) => p.id === id)!

const BILL_KEY = `mock-billing${MOCK_PLAN ? `-${MOCK_PLAN}` : ''}`
interface MockBill { plan: Account['plan']; balance: number; period_start: string | null; period_end: string | null; auto_renew: boolean; included_used: number; ledger: LedgerEntry[]; auto_top_up?: AutoTopUp | null }
const usd = (n: number) => Math.round(n * 1e6) / 1e6
const fmt = (n: number) => (Math.abs(n) >= 1 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4).replace(/0+$/, '')}`)
const nextMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()).toISOString()
const periodNote = (b: MockBill) => `Pro, ${new Date(b.period_start!).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} to ${new Date(b.period_end!).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`

function post(b: MockBill, kind: LedgerKind, amount: number, note: string, extra: Partial<LedgerEntry> = {}) {
  b.balance = usd(b.balance + amount)
  b.ledger.unshift({ id: `l-${b.ledger.length + 1}`, kind, amount: usd(amount), balance_after: b.balance, included_tokens: 0, upload_id: null, call_id: null, note, created_at: now(), ...extra })
}

let billMemo: MockBill | undefined
function bill(): MockBill {
  if (!billMemo) {
    try {
      billMemo = JSON.parse(localStorage.getItem(BILL_KEY) ?? 'null') ?? undefined
    } catch {
      // Start fresh.
    }
  }
  if (!billMemo) {
    billMemo = { plan: 'payg', balance: 0, period_start: null, period_end: null, auto_renew: true, included_used: 0, ledger: [] }
    if (billingOn() && prices.trial) post(billMemo, 'trial', prices.trial, 'Trial credit')
    if (billingOn() && MOCK_PLAN === 'pro') {
      // A Pro workspace a week into its month: topped up, fee paid, some tokens used.
      post(billMemo, 'top_up', 150, 'Card top-up · INV-0041')
      Object.assign(billMemo, { plan: 'pro', period_start: ago(7), period_end: nextMonth(new Date(ago(7))), included_used: 6_400_000, auto_renew: true })
      post(billMemo, 'subscription', -(prices.pro ?? 0), periodNote(billMemo))
    }
  }
  const b = billMemo
  if (new URLSearchParams(location.search).get('plan') === 'pro' && b.plan !== 'pro') {
    Object.assign(b, { plan: 'pro', period_start: now(), period_end: nextMonth(new Date()), included_used: 0, auto_renew: true })
  }
  // Renew or end Pro, as the backend does on every request.
  while (b.plan === 'pro' && b.period_end && Date.parse(b.period_end) <= Date.now()) {
    const fee = prices.pro ?? 0
    if (!b.auto_renew || b.balance < fee) {
      const why = !b.auto_renew ? 'it was cancelled' : `the balance couldn't cover the ${fmt(fee)} fee`
      Object.assign(b, { plan: 'payg', period_start: null, period_end: null, included_used: 0 })
      post(b, 'plan_end', 0, `Pro ended because ${why}. Now pay as you go`)
      break
    }
    Object.assign(b, { period_start: b.period_end, period_end: nextMonth(new Date(b.period_end)), included_used: 0 })
    post(b, 'subscription', -fee, periodNote(b))
  }
  saveBill()
  return b
}
function saveBill() {
  try {
    localStorage.setItem(BILL_KEY, JSON.stringify(billMemo))
  } catch {
    // Not kept.
  }
}

function billingOut(): Billing {
  const b = bill()
  const p = planPrice(b.plan)
  const { ledger: _l, included_used, auto_top_up, ...rest } = b
  return {
    ...rest, auto_top_up: auto_top_up ?? null, enabled: billingOn(), included_tokens: p.included_tokens, included_tokens_used: Math.min(included_used, p.included_tokens), alteria: p.alteria, plans: mockPlans(),
    features: features(), limits: limits(), currency: mockCurrency(), promotion: promotion(),
  }
}

function runQuote(tokens: number): Charge {
  const b = bill()
  const p = planPrice(b.plan)
  const included = Math.min(tokens, Math.max(0, p.included_tokens - b.included_used))
  const cost = usd(Math.ceil((tokens - included) * (p.price_per_million_tokens ?? 0)) / 1e6)
  const shortfall = usd(Math.max(0, cost - b.balance))
  return {
    plan: b.plan, included_tokens: included, cost, balance: b.balance, balance_after: usd(b.balance - cost), shortfall,
    message: shortfall ? `Running these calls needs up to ${fmt(cost)} in credits and your balance is ${fmt(b.balance)}. Top up at least ${fmt(shortfall)}, or choose fewer calls or trackers. Nothing was uploaded.` : null,
  }
}

function hold(uploadId: string, tokens: number, calls: number) {
  const q = runQuote(tokens)
  if (q.shortfall) throw new ApiError(q.message!, [], 402)
  const b = bill()
  b.included_used += q.included_tokens
  post(b, 'hold', -q.cost, `Held for ${calls === 1 ? '1 call' : `${calls} calls`} in upload ${uploadId}`, { upload_id: uploadId, included_tokens: q.included_tokens })
  if (b.auto_top_up?.enabled && b.balance < b.auto_top_up.below_usd) post(b, 'top_up', b.auto_top_up.amount_usd, `Auto top-up: the balance fell below ${fmt(b.auto_top_up.below_usd)}`)
  saveBill()
}

export async function getBilling(): Promise<Billing> {
  await wait(200)
  const out = billingOut()
  // B54: the backend leaves out what the role may not see. Viewers get the plan, not the money.
  return me().role === 'viewer' ? { ...out, balance: 0, auto_top_up: null, included_tokens_used: 0 } : out
}

export async function getLedger(limit = 100): Promise<LedgerEntry[]> {
  await wait(250)
  if (me().role === 'viewer') throw new ApiError('Viewers can’t see the workspace’s credits.', [], 403)
  return structuredClone(bill().ledger.slice(0, limit))
}

export async function subscribe(code?: string): Promise<Billing> {
  await wait(600)
  if (!isAdmin()) throw new ApiError('Only the owner and admins can pay for the workspace.', [], 403)
  const b = bill()
  const q = priceQuote('pro', planPrice('pro').monthly_fee ?? 0, code)
  if (q.problem) throw bad(q.problem)
  const fee = prices.pro === null ? null : q.total_usd
  if (fee === null || prices.proRate === null) throw new ApiError("Pro isn't available yet", [], 503)
  if (b.plan === 'pro') {
    b.auto_renew = true
  } else {
    if (b.balance < fee) throw new ApiError(`Pro is ${fmt(fee)} a month, paid from your credits. Your balance is ${fmt(b.balance)}: top up ${fmt(fee - b.balance)} or more to start Pro.`, [], 402)
    Object.assign(b, { plan: 'pro', period_start: now(), period_end: nextMonth(new Date()), included_used: 0, auto_renew: true })
    post(b, 'subscription', -fee, periodNote(b))
  }
  saveBill()
  return billingOut()
}

export async function cancelPlan(): Promise<Billing> {
  await wait(400)
  bill().auto_renew = false
  saveBill()
  return billingOut()
}

/** B47. The mock has no payment page: the credits arrive at once. */
export async function checkout(amount: number, code?: string): Promise<Checkout> {
  await wait(900)
  if (!isAdmin()) throw new ApiError('Only the owner and admins can pay for the workspace.', [], 403)
  if (!billingOn()) throw new ApiError('Billing is off, so there’s nothing to top up yet.', [], 409)
  // A minimum typed in local money rounds to a clean amount, so allow 10% under the USD figure.
  if (!(amount >= pricing().min_top_up_usd * 0.9)) throw bad(`The smallest top-up is ${fmt(pricing().min_top_up_usd)}`)
  const q = priceQuote('top_up', amount, code)
  if (q.problem) throw bad(q.problem)
  if (q.discount) redeem(q.discount.code)
  // You get the full amount in credits and pay the discounted total.
  post(bill(), 'top_up', amount, q.discount ? `Top-up · ${q.discount.label}, paid ${fmt(q.total_usd)}` : 'Top-up')
  saveBill()
  return { url: null, billing: billingOut() }
}

export async function getInvoices(): Promise<Invoice[]> {
  await wait(250)
  if (!isAdmin()) throw new ApiError('Only the owner and admins can see invoices.', [], 403)
  return bill().ledger
    .filter((e) => e.kind === 'top_up' || (e.kind === 'subscription' && e.amount < 0))
    .map((e) => ({ id: `INV-${String(e.id).padStart(5, '0')}`, amount: Math.abs(e.amount), kind: e.kind as Invoice['kind'], created_at: e.created_at, pdf_url: null }))
}

export async function setAutoTopUp(a: AutoTopUp): Promise<Billing> {
  await wait(400)
  if (a.enabled && (a.amount_usd < 5 || a.below_usd < 0)) throw bad('Top up at least $5, when the balance falls below $0 or more')
  bill().auto_top_up = a
  saveBill()
  return billingOut()
}

// ── Account overview (B46) ─────────────────────────────────────────────────────

const SAMPLE_CONVERSATIONS = 2_400
const storedCount = (key: string) => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as unknown[] | null)?.length
  } catch {
    return undefined
  }
}

export async function getOverview(): Promise<Overview> {
  await wait(350)
  const ids = [...spaces.keys()]
  const sample = ids.includes(SAMPLE_PROJECT) && !FRESH
  const uploaded = [...spaces.values()].flatMap((x) => (x.meta.id === currentId ? uploads : x.uploads))
  const month = DAILY.slice(-30)
  const tokens = month.reduce((a, d) => a + d[2], 0)
  const recent: Overview['recent'] = [
    ...uploads.slice(0, 3).map((u) => ({ kind: 'upload' as const, text: `Analysed ${u.status.filename}`, at: u.status.created_at, href: `/results/${u.status.upload_id}` })),
    ...readThreads().slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3).map((t) => ({ kind: 'chat' as const, text: `Asked alteria: ${t.title}`, at: t.updated_at, href: `/ask/${t.id}` })),
    ...dashboards().slice(0, 2).map((d) => ({ kind: 'dashboard' as const, text: `Updated the dashboard ${d.name}`, at: d.updated_at, href: `/dashboards/${d.id}` })),
    ...bill().ledger.filter((e) => e.kind === 'top_up' || e.kind === 'subscription').slice(0, 2).map((e) => ({ kind: (e.kind === 'top_up' ? 'credits' : 'plan') as 'credits' | 'plan', text: e.note ?? 'Credits', at: e.created_at, href: '/settings/credits' })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
  return {
    counts: {
      projects: ids.length,
      trackers: ids.reduce((a, id) => a + (id === currentId ? store : spaces.get(id)!.store).length, 0),
      dashboards: ids.reduce((a, id) => a + (id === currentId ? dashboards().length : storedCount(dashKey(id)) ?? (id === SAMPLE_PROJECT && !FRESH ? SEED.length : 0)), 0),
      conversations: (sample ? SAMPLE_CONVERSATIONS : 0) + uploaded.reduce((a, u) => a + u.calls.length, 0),
      chats: ids.reduce((a, id) => a + (id === currentId ? readThreads().length : storedCount(threadKey(id)) ?? 0), 0),
      members: team().members.length,
    },
    month: { tokens, spend: cost(tokens), conversations: month.reduce((a, d) => a + d[0], 0) },
    recent,
  }
}

// ── People (B42) ───────────────────────────────────────────────────────────────
// A made-up clinic team, so Settings → Team, shared chats and avatars have someone in them.
// ?role=admin|member|viewer signs in as that role instead of the owner.
// Plan limits (B48), like the backend would set them: everything is open while billing is off.
// On pay as you go, 3 people who can ask and analyse (viewers are free), and no Pro features.

const TEAM_KEY = 'mock-team'
const ME_KEY = 'mock-me'
const DOMAIN = 'sunriseclinic.example'
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()

const inviteLink = (id: string) => `${location.origin}/invite/${id}`
const SEED_TEAM = (): Team => ({
  members: [
    { id: 'u-sam', name: 'Sam Rivera', email: `sam@${DOMAIN}`, role: 'owner', avatar_url: null, joined_at: ago(120), last_active_at: ago(0) },
    { id: 'u-priya', name: 'Priya Shah', email: `priya@${DOMAIN}`, role: 'admin', avatar_url: null, joined_at: ago(96), last_active_at: ago(0, 3) },
    { id: 'u-daniel', name: 'Daniel Okafor', email: `daniel@${DOMAIN}`, role: 'member', avatar_url: null, joined_at: ago(40), last_active_at: ago(2) },
    { id: 'u-mei', name: 'Mei Chen', email: `mei@${DOMAIN}`, role: 'viewer', avatar_url: null, joined_at: ago(12), last_active_at: ago(6) },
  ],
  invites: [
    { id: 'i-jordan', email: `jordan@${DOMAIN}`, role: 'viewer', invited_by: { id: 'u-priya', name: 'Priya Shah', avatar_url: null }, created_at: ago(1), expires_at: ago(-6), link: inviteLink('i-jordan') },
  ],
  limit: null,
})

let teamState: Team | undefined
function team(): Team {
  if (!teamState) {
    try {
      teamState = JSON.parse(localStorage.getItem(TEAM_KEY) ?? 'null') ?? undefined
    } catch {
      // Start from the seed.
    }
    teamState ??= FRESH ? { ...SEED_TEAM(), members: SEED_TEAM().members.slice(0, 1), invites: [] } : SEED_TEAM()
  }
  return teamState
}
function saveTeam() {
  try {
    localStorage.setItem(TEAM_KEY, JSON.stringify(team()))
  } catch {
    // Kept for this visit.
  }
}

const ROLE_SWITCH = ((): Role | null => {
  // ?role= sticks until another ?role= (or a reset on /dev/flows); ?role=owner goes back.
  const q = new URLSearchParams(location.search).get('role') as Role | null
  try {
    if (q) localStorage.setItem('mock-role', q)
    return (localStorage.getItem('mock-role') as Role | null) ?? null
  } catch {
    return q
  }
})()
function me(): Member {
  const ms = team().members
  const picked = ls.get(ME_ID_KEY)
  const mine = picked ? ms.find((m) => m.id === picked) : undefined
  if (mine) return mine
  const as = ROLE_SWITCH && ROLE_SWITCH !== 'owner' ? ms.find((m) => m.role === ROLE_SWITCH) : undefined
  return as ?? ms.find((m) => m.role === 'owner')!
}
const person = ({ id, name, avatar_url }: Person): Person => ({ id, name, avatar_url })
const isAdmin = () => me().role === 'owner' || me().role === 'admin'
/** What the backend sends in /me.permissions (B54): the page uses it to hide what the role can't do. */
const permissionsOf = (r: Role) => r === 'owner' || r === 'admin'
  ? ['analyse', 'trackers.edit', 'ask', 'projects.manage', 'billing.view', 'billing.manage', 'usage.self', 'usage.members', 'team.manage', 'workspace.edit']
  : r === 'member' ? ['analyse', 'trackers.edit', 'ask', 'billing.view', 'usage.self'] : ['ask']

// ── Sign-in, onboarding and the workspace (B42, B50) ───────────────────────────
// Signed in and set up by default, so the rest of the app works as before. In the URL:
//   ?signed-out   start signed out, at /login
//   ?onboarding   sign in as someone new (alex@…), who goes through /onboarding
// The emailed link is simulated: /login shows "Open the link" instead of sending mail.

const SESSION_KEY = 'mock-session'
const ONBOARDING_KEY = 'mock-onboarding'
const ME_ID_KEY = 'mock-me-id'
const WORKSPACE_KEY = 'mock-workspace'
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      // This visit only.
    }
  },
}
{
  const q = new URLSearchParams(location.search)
  if (q.has('signed-out')) ls.set(SESSION_KEY, 'out')
  if (q.has('onboarding')) {
    ls.set(ONBOARDING_KEY, '1')
    ls.set(SESSION_KEY, 'in')
  }
}
const signedIn = () => ls.get(SESSION_KEY) !== 'out'

// B64: a sign-in lasts 5 hours. ?session=90 makes it 90 seconds, to see the warning and sign-out.
const SESSION_START_KEY = 'mock-session-start'
const SESSION_MS = (() => {
  const q = Number(new URLSearchParams(location.search).get('session'))
  if (q > 0) ls.set('mock-session-seconds', String(q))
  const saved = Number(ls.get('mock-session-seconds'))
  return (saved > 0 ? saved : 5 * 3600) * 1000
})()
function sessionStart() {
  let t = Number(ls.get(SESSION_START_KEY))
  if (!t) {
    t = Date.now()
    ls.set(SESSION_START_KEY, String(t))
  }
  return t
}
const sessionExpired = () => Date.now() >= sessionStart() + SESSION_MS

const signedOutListeners = new Set<() => void>()
export const onSignedOut = (fn: () => void) => (signedOutListeners.add(fn), () => void signedOutListeners.delete(fn))
function unauthorized() {
  signedOutListeners.forEach((l) => l())
  return new ApiError('Your session has ended. Sign in again.', [], 401)
}

/** The new person ?onboarding signs in as. Not in the team until they join or create a workspace. */
const NEWCOMER = { id: 'u-alex', name: '', email: `alex@${DOMAIN}`, role: 'owner' as Role, avatar_url: null }

const SEED_WORKSPACE = (): Workspace => ({
  id: 'w-sunrise', name: 'Sunrise Clinic', slug: 'sunrise-clinic', logo_url: null,
  allowed_domains: [DOMAIN], join_by_domain: true, default_role: 'member',
})
let workspaceState: Workspace | undefined
function workspace(): Workspace {
  try {
    workspaceState ??= JSON.parse(ls.get(WORKSPACE_KEY) ?? 'null') ?? undefined
  } catch {
    // The seed.
  }
  return (workspaceState ??= SEED_WORKSPACE())
}
const saveWorkspace = () => ls.set(WORKSPACE_KEY, JSON.stringify(workspace()))

/** Addresses the product itself uses, and ones already taken by other workspaces. */
const RESERVED = ['admin', 'api', 'app', 'aftercall', 'alteria', 'login', 'signup', 'settings', 'pricing', 'help', 'invite', 'onboarding', 'www']
const TAKEN = ['acme', 'northwind', 'globex']
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
function slugProblem(slug: string): string | null {
  if (!SLUG.test(slug) || slug.includes('--')) return 'Use 3 to 40 lowercase letters, numbers and single dashes, starting and ending with a letter or number.'
  return null
}
const slugFree = (slug: string) => slug === workspace().slug ? true : !RESERVED.includes(slug) && !TAKEN.includes(slug)

export async function checkSlug(slug: string): Promise<SlugCheck> {
  await wait(250)
  const bad = slugProblem(slug)
  if (bad) throw new ApiError(bad, [bad], 422)
  if (slugFree(slug)) return { slug, available: true, suggestion: null }
  let n = 2
  while (!slugFree(`${slug}-${n}`)) n++
  return { slug, available: false, suggestion: `${slug}-${n}` }
}

export async function getWorkspace(): Promise<Workspace> {
  await wait(150)
  return structuredClone(workspace())
}

/** Email providers anyone can sign up with: never a workspace's own domain. */
const PUBLIC_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com']

export async function updateWorkspace(patch: WorkspacePatch): Promise<Workspace> {
  await wait(350)
  if (!isAdmin()) throw new ApiError('Only the owner and admins can change the workspace.', [], 403)
  const w = workspace()
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (name.length < 2 || name.length > 60) throw bad('A workspace name is 2 to 60 characters')
    w.name = name
  }
  if (patch.slug !== undefined && patch.slug !== w.slug) {
    const problem = slugProblem(patch.slug)
    if (problem) throw bad(problem)
    if (!slugFree(patch.slug)) throw new ApiError(`${WORKSPACE_HOST}/${patch.slug} is taken. Try another address.`, [], 409)
    w.slug = patch.slug
  }
  if (patch.allowed_domains) {
    const ds = [...new Set(patch.allowed_domains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))]
    const odd = ds.find((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))
    if (odd) throw bad(`${odd} isn't a domain, like sunriseclinic.com`)
    const open = ds.find((d) => PUBLIC_DOMAINS.includes(d))
    if (open) throw bad(`Anyone can get an @${open} address, so it can't let people join. Use your company's domain.`)
    // The backend only allows domains that someone in the workspace has a verified email at.
    const mine = new Set(team().members.map((m) => m.email.split('@')[1]))
    const unverified = ds.find((d) => !mine.has(d))
    if (unverified) throw new ApiError(`No one in the workspace has a verified @${unverified} email yet, so it can't be added.`, [], 422)
    w.allowed_domains = ds
  }
  if (patch.join_by_domain !== undefined) w.join_by_domain = patch.join_by_domain
  if (patch.default_role) w.default_role = patch.default_role
  saveWorkspace()
  return structuredClone(w)
}

export async function requestSignInLink(email: string): Promise<void> {
  await wait(600)
  const e = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('Enter an email address, like name@company.com')
}

/** The mock has no Google: the button goes straight to the page the real OAuth comes back to. */
export const googleSignInUrl = (next?: string) => `/login/verify?token=google${next ? `&next=${encodeURIComponent(next)}` : ''}`

export async function verifySignIn(token: string): Promise<SignedIn> {
  await wait(700)
  if (token === 'expired') throw new ApiError('This sign-in link has expired or was already used. Links work once, for 15 minutes.', [], 400)
  ls.set(SESSION_KEY, 'in')
  ls.set(SESSION_START_KEY, String(Date.now()))
  const me = await getMe()
  return { me, new_user: !me.onboarded }
}

export async function signOut(): Promise<void> {
  await wait(250)
  ls.set(SESSION_KEY, 'out')
  ls.set(SESSION_START_KEY, null)
  ls.set(ME_ID_KEY, null)
}

export async function getInvite(token: string): Promise<InviteInfo> {
  await wait(300)
  const inv = team().invites.find((i) => i.id === token) ?? (token === 'demo' ? team().invites[0] : undefined)
  if (!inv) throw new ApiError('This invite has expired or was revoked. Ask whoever invited you to send a new one.', [], 404)
  const w = workspace()
  return { workspace: { name: w.name, slug: w.slug, logo_url: w.logo_url }, invited_by: inv.invited_by, email: inv.email, role: inv.role, expires_at: inv.expires_at }
}

export async function acceptInvite(token: string): Promise<Me> {
  await wait(500)
  const t = team()
  const inv = t.invites.find((i) => i.id === token) ?? (token === 'demo' ? t.invites[0] : undefined)
  if (!inv) throw new ApiError('This invite has expired or was revoked.', [], 404)
  const name = inv.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const m: Member = { id: `u-${inv.id}`, name, email: inv.email, role: inv.role, avatar_url: null, joined_at: now(), last_active_at: now() }
  t.members.push(m)
  t.invites = t.invites.filter((i) => i !== inv)
  saveTeam()
  ls.set(ME_ID_KEY, m.id)
  ls.set(SESSION_KEY, 'in')
  ls.set(ONBOARDING_KEY, null)
  return { ...meOut(), onboarded: true }
}

export async function listJoinable(): Promise<JoinableWorkspace[]> {
  await wait(300)
  const w = workspace()
  const domain = NEWCOMER.email.split('@')[1]
  if (!w.join_by_domain || !w.allowed_domains.includes(domain)) return []
  return [{ slug: w.slug, name: w.name, logo_url: w.logo_url, members: team().members.length, role: w.default_role }]
}

export async function completeOnboarding(o: OnboardingIn): Promise<Me> {
  await wait(800)
  const name = o.name.trim()
  if (!name || name.length > 60) throw bad('A name is 1 to 60 characters')
  const t = team()
  if (o.join) {
    const w = workspace()
    if (o.join !== w.slug || !(await listJoinable()).length) throw new ApiError('You can’t join that workspace without an invite.', [], 403)
    t.members.push({ ...NEWCOMER, name, role: w.default_role, joined_at: now(), last_active_at: now() })
  } else if (o.workspace) {
    const problem = slugProblem(o.workspace.slug)
    if (problem) throw bad(problem)
    if (TAKEN.includes(o.workspace.slug) || RESERVED.includes(o.workspace.slug)) throw new ApiError(`${WORKSPACE_HOST}/${o.workspace.slug} is taken. Try another address.`, [], 409)
    workspaceState = { ...SEED_WORKSPACE(), id: 'w-new', ...o.workspace, name: o.workspace.name.trim(), default_role: 'member' }
    saveWorkspace()
    teamState = { members: [{ ...NEWCOMER, name, role: 'owner', joined_at: now(), last_active_at: now() }], invites: [], limit: null }
    for (const i of o.invites ?? []) {
      const id = `i-${Math.random().toString(36).slice(2, 8)}`
      teamState.invites.push({ id, link: inviteLink(id), email: i.email.trim().toLowerCase(), role: i.role, invited_by: { id: NEWCOMER.id, name, avatar_url: null }, created_at: now(), expires_at: ago(-7) })
    }
  } else {
    throw bad('Join a workspace or create one')
  }
  saveTeam()
  ls.set(ME_ID_KEY, NEWCOMER.id)
  ls.set(ONBOARDING_KEY, null)
  return { ...meOut(), onboarded: true }
}

function features(): PlanFeatures {
  const on = !billingOn() || bill().plan === 'pro'
  return { share_chats: on, bulk_export: on, import_documents: on, audit_log: on }
}
function limits(): PlanLimits {
  const payg = billingOn() && bill().plan === 'payg'
  return { teammates: payg ? 3 : null, projects: limitOf(bill().plan), alteria_trial_left: payg ? Math.max(0, ASK_TRIAL - askTrialUsed()) : null }
}

// Ask alteria's free questions on pay as you go, counted here like the backend will (B49).
const ASK_TRIAL = 3
const ASK_KEY = `mock-ask-trial${MOCK_PLAN ? `-${MOCK_PLAN}` : ''}`
const askTrialUsed = () => {
  try {
    return Number(localStorage.getItem(ASK_KEY)) || 0
  } catch {
    return 0
  }
}
function spendAskTrial() {
  if (!billingOn() || bill().plan === 'pro') return
  const used = askTrialUsed()
  if (used >= ASK_TRIAL) throw new ApiError(`You’ve used your ${ASK_TRIAL} free questions. Ask alteria is part of Pro.`, [], 402)
  try {
    localStorage.setItem(ASK_KEY, String(used + 1))
  } catch {
    // Not counted: the mock only.
  }
}
/** People who count toward the limit: everyone but viewers, and open invites for them. */
const seats = (t: Team) => t.members.filter((m) => m.role !== 'viewer').length + t.invites.filter((i) => i.role !== 'viewer').length

let meExtra: Pick<Me, 'sign_in' | 'notifications'> | undefined
function meOut(): Me {
  if (!meExtra) {
    try {
      meExtra = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') ?? undefined
    } catch {
      // Defaults below.
    }
    meExtra ??= { sign_in: { email: true, google: true }, notifications: { low_balance: true, weekly_digest: true, shared_chats: true, run_finished: false } }
  }
  return { ...me(), ...meExtra }
}

export async function getMe(): Promise<Me> {
  await wait(150)
  if (!signedIn()) throw unauthorized()
  if (sessionExpired()) {
    ls.set(SESSION_KEY, 'out')
    throw unauthorized()
  }
  const session_expires_at = new Date(sessionStart() + SESSION_MS).toISOString()
  if (ls.get(ONBOARDING_KEY)) return { ...NEWCOMER, ...meOut(), ...NEWCOMER, onboarded: false, session_expires_at }
  return { ...meOut(), onboarded: true, permissions: permissionsOf(me().role), session_expires_at }
}

export async function updateMe(patch: MePatch): Promise<Me> {
  await wait(300)
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name || name.length > 60) throw bad('A name is 1 to 60 characters')
    me().name = name
    saveTeam()
  }
  if (patch.notifications) {
    const cur = meOut()
    meExtra = { ...cur, notifications: { ...cur.notifications, ...patch.notifications } }
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(meExtra))
    } catch {
      // Kept for this visit.
    }
  }
  return meOut()
}

export async function getTeam(): Promise<Team> {
  await wait(250)
  return structuredClone({ ...team(), limit: limits().teammates })
}

const adminOnly = () => {
  if (!isAdmin()) throw new ApiError('Only the owner and admins can manage the team.', [], 403)
}

export async function invite(email: string, role: Invite['role']): Promise<Invite> {
  await wait(400)
  adminOnly()
  const e = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('Enter an email address, like name@company.com')
  const t = team()
  if (t.members.some((m) => m.email === e)) throw new ApiError(`${e} is already in the workspace.`, [], 409)
  if (t.invites.some((i) => i.email === e)) throw new ApiError(`${e} already has an invite. Resend it from the list.`, [], 409)
  const limit = limits().teammates
  if (limit !== null && role !== 'viewer' && seats(t) >= limit)
    throw new ApiError(`Pay as you go includes ${limit} people who can ask and analyse, and you have ${seats(t)}. Start Pro for unlimited teammates, or invite them as a viewer: viewers are free.`, [], 402)
  const id = `i-${Math.random().toString(36).slice(2, 8)}`
  const inv: Invite = { id, link: inviteLink(id), email: e, role, invited_by: person(me()), created_at: now(), expires_at: ago(-7) }
  t.invites.unshift(inv)
  saveTeam()
  return inv
}

export async function resendInvite(id: string): Promise<Invite> {
  await wait(300)
  adminOnly()
  const inv = team().invites.find((i) => i.id === id)
  if (!inv) throw new ApiError('That invite was accepted or revoked.', [], 404)
  Object.assign(inv, { created_at: now(), expires_at: ago(-7) })
  saveTeam()
  return inv
}

export async function revokeInvite(id: string): Promise<void> {
  await wait(250)
  adminOnly()
  team().invites = team().invites.filter((i) => i.id !== id)
  saveTeam()
}

export async function setRole(id: string, role: Exclude<Role, 'owner'>): Promise<Member> {
  await wait(300)
  adminOnly()
  const t = team()
  const m = t.members.find((x) => x.id === id)
  if (!m) throw new ApiError('They’re no longer in the workspace.', [], 404)
  if (m.role === 'owner') throw new ApiError('The owner’s role can’t change. Transfer the workspace first.', [], 409)
  const limit = limits().teammates
  if (limit !== null && m.role === 'viewer' && role !== 'viewer' && seats(t) >= limit)
    throw new ApiError(`Pay as you go includes ${limit} people who can ask and analyse. Start Pro to make ${m.name.split(' ')[0]} a ${role}.`, [], 402)
  m.role = role
  saveTeam()
  return m
}

export async function removeMember(id: string): Promise<void> {
  await wait(300)
  adminOnly()
  const t = team()
  const m = t.members.find((x) => x.id === id)
  if (m?.role === 'owner') throw new ApiError('The owner can’t be removed.', [], 409)
  if (m?.id === me().id) throw new ApiError('You can’t remove yourself. Ask another admin.', [], 409)
  t.members = t.members.filter((x) => x.id !== id)
  saveTeam()
}

// ── Notifications (B52) ────────────────────────────────────────────────────────
// A week of the things a team sees, three unread. A new one arrives about 40 s into a visit, so the
// bell's count and the toast can be seen. ?quiet starts with none.

const NOTE_KEY = 'mock-notifications'
const QUIET = new URLSearchParams(location.search).has('quiet')
const priya = { id: 'u-priya', name: 'Priya Shah', avatar_url: null }
const daniel = { id: 'u-daniel', name: 'Daniel Okafor', avatar_url: null }
const SEED_NOTES = (): AppNotification[] => [
  { id: 'n-1', kind: 'run_finished', title: 'calls-week-38.json is analysed', body: '412 conversations · 9 need review', href: '/results', actor: null, project_id: null, created_at: ago(0, 0.3), read: false },
  { id: 'n-2', kind: 'chat_shared', title: 'Priya shared a chat with the team', body: '“Why are reschedules up this week?”', href: '/ask', actor: priya, project_id: null, created_at: ago(0, 2), read: false },
  { id: 'n-3', kind: 'low_balance', title: 'Credits are running low', body: 'About 5 days left at this week’s pace.', href: '/settings/credits/add', actor: null, project_id: null, created_at: ago(0, 5), read: false },
  { id: 'n-4', kind: 'invite_accepted', title: 'Mei Chen joined as a viewer', body: null, href: '/settings/team', actor: { id: 'u-mei', name: 'Mei Chen', avatar_url: null }, project_id: null, created_at: ago(1, 3), read: true },
  { id: 'n-5', kind: 'alert', title: 'Booking confirmed fell to 71%', body: 'From 84% last week, on agent v2.3.', href: '/insights', actor: null, project_id: null, created_at: ago(2), read: true },
  { id: 'n-6', kind: 'run_failed', title: '3 conversations in support-sept.csv couldn’t be read', body: 'They had no transcript. The rest are analysed.', href: '/results', actor: null, project_id: null, created_at: ago(3), read: true },
  { id: 'n-8', kind: 'allowance_warning', title: 'You’ve used 80% of your allowance', body: 'This month’s share of the workspace’s budget. It resets on the 1st.', href: '/settings/usage', actor: null, project_id: null, created_at: ago(0, 1), read: false },
  { id: 'n-7', kind: 'credits_added', title: '$50.00 of credits added', body: 'Invoice INV-0042', href: '/settings/credits', actor: daniel, project_id: null, created_at: ago(5), read: true },
]
let notes: AppNotification[] | undefined
function allNotes() {
  if (!notes) {
    try {
      notes = JSON.parse(localStorage.getItem(NOTE_KEY) ?? 'null') ?? undefined
    } catch {
      // The seed.
    }
    notes ??= QUIET || FRESH ? [] : SEED_NOTES()
  }
  return notes
}
const saveNotes = () => {
  try {
    localStorage.setItem(NOTE_KEY, JSON.stringify(allNotes()))
  } catch {
    // This visit only.
  }
}
if (!QUIET) {
  setTimeout(() => {
    allNotes().unshift({ id: `n-${Date.now()}`, kind: 'run_finished', title: 'sample-calls.json is analysed', body: '25 conversations · all confident', href: '/results', actor: null, project_id: null, created_at: now(), read: false })
    saveNotes()
  }, 40_000)
}

export async function listNotifications(opts: { unread?: boolean; cursor?: string } = {}): Promise<NotificationPage> {
  await wait(200)
  // Like the backend (B52, B66): only what this person should see. Owners and admins have no
  // allowance; viewers see no money, and their allowance notices link nowhere (no Usage page).
  const role = me().role
  const all = allNotes()
    .filter((n) => !(n.kind.startsWith('allowance') && isAdmin()))
    .filter((n) => !(role === 'viewer' && ['low_balance', 'credits_added', 'plan_renewing'].includes(n.kind)))
    .map((n) => (role === 'viewer' && n.kind.startsWith('allowance') ? { ...n, href: null, body: 'Ask an owner or admin if you need more.' } : n))
  const items = opts.unread ? all.filter((n) => !n.read) : all
  return { items: structuredClone(items), unread: all.filter((n) => !n.read).length, next_cursor: null }
}

export async function markNotificationsRead(ids?: string[]): Promise<{ unread: number }> {
  await wait(150)
  for (const n of allNotes()) if (!ids || ids.includes(n.id)) n.read = true
  saveNotes()
  return { unread: (await listNotifications()).unread }
}

// ── Currency, regional prices, discounts (B55, B56) ────────────────────────────
// The currency comes from the browser's time zone, like the backend would from the visitor's IP.
// ?currency=INR|EUR|GBP|USD picks one. Amounts stay in USD; the page converts only for display.

const RATES: Record<string, number> = { USD: 1, INR: 83.1, EUR: 0.92, GBP: 0.79, AED: 3.67, SGD: 1.35 }
const ZONES: [RegExp, string, string][] = [
  [/Asia\/(Kolkata|Calcutta)/, 'IN', 'INR'], [/Europe\/London/, 'GB', 'GBP'], [/Europe\//, 'DE', 'EUR'], [/Asia\/Dubai/, 'AE', 'AED'], [/Asia\/Singapore/, 'SG', 'SGD'],
]
const COUNTRY_OF: Record<string, string> = { INR: 'IN', GBP: 'GB', EUR: 'DE', AED: 'AE', SGD: 'SG', USD: 'US' }
function mockCurrency(): DisplayCurrency {
  // ?currency=INR sticks for the visit (and the next ones); ?currency=auto goes back to the time zone.
  const asked = new URLSearchParams(location.search).get('currency')?.toUpperCase()
  if (asked) ls.set('mock-currency', asked === 'AUTO' ? null : asked)
  const q = ls.get('mock-currency') ?? undefined
  if (q && RATES[q]) return { code: q, rate: RATES[q], country: COUNTRY_OF[q] ?? null, source: 'workspace' }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const hit = ZONES.find(([re]) => re.test(zone))
  return hit ? { code: hit[2], rate: RATES[hit[2]], country: hit[1], source: 'geo' } : { code: 'USD', rate: 1, country: 'US', source: 'geo' }
}

const PRICING_KEY = 'mock-pricing-config'
function pricing(): PricingConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(PRICING_KEY) ?? 'null')
    if (saved) return saved
  } catch {
    // The defaults.
  }
  return {
    payg_per_million: prices.payg ?? 0.5, pro_monthly_fee: prices.pro ?? 49, pro_per_million: prices.proRate ?? 0.35, pro_included_tokens: prices.proTokens,
    trial_credit_usd: prices.trial, min_top_up_usd: 5,
    regions: [{ country: 'IN', currency: 'INR', multiplier: 0.6 }, { country: 'GB', currency: 'GBP', multiplier: 1 }, { country: 'DE', currency: 'EUR', multiplier: 1 }],
    updated_at: null, updated_by: null,
  }
}
const regionFor = (country: string | null) => (country ? pricing().regions.find((r) => r.country === country) : undefined)

const DISCOUNTS_KEY = 'mock-discounts'
const SEED_DISCOUNTS = (): Discount[] => [
  { id: 'd-launch', code: null, label: 'Launch offer: 25% off your first month of Pro', percent_off: 25, amount_off_usd: null, applies_to: ['pro'], countries: [], starts_at: ago(3), ends_at: ago(-11), max_redemptions: null, redemptions: 41, first_payment_only: true, active: true },
  { id: 'd-welcome', code: 'WELCOME20', label: '20% off a top-up', percent_off: 20, amount_off_usd: null, applies_to: ['top_up'], countries: [], starts_at: null, ends_at: null, max_redemptions: 500, redemptions: 112, first_payment_only: false, active: true },
  { id: 'd-india', code: 'NAMASTE10', label: '$10 off a top-up of $50 or more', percent_off: null, amount_off_usd: 10, applies_to: ['top_up'], countries: ['IN'], starts_at: null, ends_at: ago(-30), max_redemptions: 200, redemptions: 12, first_payment_only: false, active: true },
  { id: 'd-old', code: 'BETA50', label: 'Beta testers: 50% off', percent_off: 50, amount_off_usd: null, applies_to: ['top_up', 'pro'], countries: [], starts_at: ago(90), ends_at: ago(30), max_redemptions: 50, redemptions: 50, first_payment_only: false, active: false },
]
let discountState: Discount[] | undefined
function discounts(): Discount[] {
  try {
    discountState ??= JSON.parse(localStorage.getItem(DISCOUNTS_KEY) ?? 'null') ?? undefined
  } catch {
    // The seed.
  }
  return (discountState ??= SEED_DISCOUNTS())
}
const saveDiscounts = () => {
  try {
    localStorage.setItem(DISCOUNTS_KEY, JSON.stringify(discounts()))
  } catch {
    // This visit only.
  }
}
const live = (d: Discount) => d.active && (!d.starts_at || Date.parse(d.starts_at) <= Date.now()) && (!d.ends_at || Date.parse(d.ends_at) > Date.now()) && (d.max_redemptions === null || d.redemptions < d.max_redemptions)
function promotion(): Promotion | null {
  const country = mockCurrency().country
  const d = discounts().find((x) => x.code === null && live(x) && (!x.countries.length || (country && x.countries.includes(country))))
  return d ? { label: d.label, percent_off: d.percent_off, amount_off_usd: d.amount_off_usd, applies_to: d.applies_to, ends_at: d.ends_at } : null
}
function redeem(code: string | null) {
  const d = discounts().find((x) => x.code === code)
  if (d) (d.redemptions++, saveDiscounts())
}

function priceQuote(kind: 'top_up' | 'pro', amount: number, code?: string): Quote {
  const country = mockCurrency().country
  const typed = code?.trim().toUpperCase()
  const base: Quote = { kind, subtotal_usd: amount, discount_usd: 0, total_usd: amount, credits_usd: kind === 'top_up' ? amount : 0, discount: null, problem: null }
  let d: Discount | undefined
  if (typed) {
    d = discounts().find((x) => x.code === typed)
    const why = !d ? `${typed} isn’t a code we know.`
      : !live(d) ? `${typed} has ended.`
      : !d.applies_to.includes(kind) ? `${typed} is for ${d.applies_to.includes('pro') ? 'Pro' : 'top-ups'} only.`
      : d.countries.length && !(country && d.countries.includes(country)) ? `${typed} isn’t available where you are.`
      : d.amount_off_usd && amount < d.amount_off_usd * 5 ? `${typed} needs a top-up of ${fmt(d.amount_off_usd * 5)} or more.`
      : null
    if (why) return { ...base, problem: why }
  } else {
    d = discounts().find((x) => x.code === null && live(x) && x.applies_to.includes(kind) && (!x.countries.length || (country && x.countries.includes(country))))
    if (d?.first_payment_only && kind === 'pro' && bill().ledger.some((e) => e.kind === 'subscription')) d = undefined
  }
  if (!d) return base
  const off = Math.min(amount, usd(d.percent_off ? (amount * d.percent_off) / 100 : d.amount_off_usd ?? 0))
  return { ...base, discount_usd: off, total_usd: usd(amount - off), discount: { code: d.code, label: d.label } }
}

export async function quote(kind: 'top_up' | 'pro', amount: number, code?: string): Promise<Quote> {
  await wait(300)
  return priceQuote(kind, amount, code)
}

// ── Usage by person, allowances (B54) ──────────────────────────────────────────

// B54: the allowance policy. Defaults out of the gate: members 50%, viewers 25% of the month's
// budget, which is the credits the workspace had when the month began, until an owner fixes one.
const POLICY_KEY = 'mock-allowance-policy'
interface MockPolicy { basis: 'balance' | 'fixed'; monthly_usd: number | null; roles: { member: number; viewer: number }; overrides: Record<string, number> }
const DEFAULT_POLICY = (): MockPolicy => ({ basis: 'balance', monthly_usd: null, roles: { member: 0.5, viewer: 0.25 }, overrides: { 'u-daniel': 0.3 } })
function policy(): MockPolicy {
  try {
    return JSON.parse(localStorage.getItem(POLICY_KEY) ?? 'null') ?? DEFAULT_POLICY()
  } catch {
    return DEFAULT_POLICY()
  }
}
/** The month's budget: fixed, or what the workspace had when the month began (balance + spent since). */
const monthlyBudget = (p: MockPolicy, spentThisMonth: number) => (p.basis === 'fixed' && p.monthly_usd !== null ? p.monthly_usd : usd(bill().balance + spentThisMonth))
const shareOf = (p: MockPolicy, id: string, role: Role) => (role === 'owner' || role === 'admin' ? null : p.overrides[id] ?? p.roles[role === 'viewer' ? 'viewer' : 'member'])
const monthEnd = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString() }
/** Each person's share of the workspace's tokens, fixed per person so the numbers stay put. */
const SHARE: Record<string, number> = { 'u-sam': 0.34, 'u-priya': 0.41, 'u-daniel': 0.25 }

async function usageFor(start: string, end: string): Promise<MembersUsage> {
  const u = await getUsage(start, end)
  const t = u.totals
  const spend = t.cost
  const workspace = { tokens: t.billed_input_tokens, spend, conversations: t.calls_analyzed }
  const members: MemberUsage[] = team().members.map((m) => {
    const share = SHARE[m.id] ?? (m.role === 'viewer' ? 0.03 : 0.1)
    const p = policy()
    const cap = shareOf(p, m.id, m.role)
    const monthly = cap === null ? null : usd(cap * monthlyBudget(p, spend ?? 0))
    const used = spend === null ? 0 : usd(spend * share * 1.6)
    return {
      member: { id: m.id, name: m.name, avatar_url: m.avatar_url, role: m.role, email: m.email },
      tokens: Math.round(t.billed_input_tokens * share), spend: spend === null ? null : usd(spend * share), conversations: Math.round(t.calls_analyzed * share),
      alteria_questions: Math.round(38 * share) || (m.role === 'viewer' ? 2 : 0),
      allowance: { monthly_usd: monthly, used_usd: used, resets_at: monthEnd() },
    }
  })
  return { start, end, workspace, members: members.sort((a, b) => b.tokens - a.tokens) }
}

export async function getMembersUsage(start: string, end: string): Promise<MembersUsage> {
  if (!isAdmin()) throw new ApiError('Only the owner and admins can see everyone’s usage.', [], 403)
  return usageFor(start, end)
}

export async function getMyUsage(start: string, end: string): Promise<MembersUsage> {
  if (me().role === 'viewer') throw new ApiError('Viewers don’t see usage.', [], 403)
  const all = await usageFor(start, end)
  return { ...all, members: all.members.filter((m) => m.member.id === me().id) }
}

export async function getAllowances(): Promise<AllowancePolicy> {
  await wait(250)
  if (!isAdmin()) throw new ApiError('Only the owner and admins can see allowances.', [], 403)
  const p = policy()
  const u = await usageFor('', '')
  const budget = monthlyBudget(p, u.workspace.spend ?? 0)
  return {
    budget: { basis: p.basis, monthly_usd: p.monthly_usd, effective_usd: budget },
    roles: p.roles,
    people: u.members.map((m) => {
      const cap = shareOf(p, m.member.id, m.member.role)
      return { member: m.member, override: p.overrides[m.member.id] ?? null, effective_usd: cap === null ? null : usd(cap * budget), used_usd: m.allowance.used_usd }
    }),
    resets_at: monthEnd(),
  }
}

export async function saveAllowances(change: AllowancePolicyIn): Promise<AllowancePolicy> {
  await wait(450)
  if (!isAdmin()) throw new ApiError('Only the owner and admins can change allowances.', [], 403)
  const p = policy()
  const share = (x: number) => x >= 0 && x <= 1
  if (change.roles && Object.values(change.roles).some((x) => x !== undefined && !share(x))) throw bad('A share is from 0% to 100%')
  if (change.budget) {
    if (change.budget.basis === 'fixed' && !(Number(change.budget.monthly_usd) > 0)) throw bad('A fixed budget needs an amount')
    p.basis = change.budget.basis
    p.monthly_usd = change.budget.basis === 'fixed' ? change.budget.monthly_usd : null
  }
  if (change.roles) p.roles = { ...p.roles, ...Object.fromEntries(Object.entries(change.roles).filter(([, v]) => v !== undefined)) }
  for (const [id, v] of Object.entries(change.overrides ?? {})) {
    if (v === null) delete p.overrides[id]
    else if (share(v)) p.overrides[id] = v
    else throw bad('A share is from 0% to 100%')
  }
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify(p))
  } catch {
    // This visit only.
  }
  return getAllowances()
}

// ── Docs feedback (B65) ────────────────────────────────────────────────────────

export async function sendDocFeedback(slug: string, helpful: boolean, comment?: string): Promise<void> {
  await wait(300)
  if (comment && comment.length > 1000) throw bad('Keep it under 1,000 characters')
  try {
    const all = JSON.parse(localStorage.getItem('mock-doc-feedback') ?? '[]')
    all.push({ slug, helpful, comment: comment?.trim() || null, at: now() })
    localStorage.setItem('mock-doc-feedback', JSON.stringify(all))
  } catch {
    // Not kept; the mock only.
  }
}
