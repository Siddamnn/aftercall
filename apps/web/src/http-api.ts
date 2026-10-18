// The real backend (apps/backend/aftercall/api.py). The browser never holds a key: in dev, Vite's
// proxy adds the tenant's X-API-Key on the server (vite.config.ts); deployed, every request carries
// the Firebase ID token of the signed-in person (src/firebase.ts). What the plan allows is decided by the backend on every
// request (B49); the UI only hides what the backend would refuse.
// The backend says trackers and signals like the UI (request B4), so responses pass through as-is.
import {
  ApiError,
  type Breakdown, type Bucket, type CallPage, type CallQuery, type CallResult, type Dashboard, type DashboardIn, type Dimensions, type ImportResult, type Insights,
  type InsightScope, type OnConflict, type Account, type Project, type ProjectIn, type AlteriaConversations, type AlteriaSignal, type AlteriaTrackers, type AlteriaAnswer, type AskThread, type AskThreadPage, type AskThreadPatch, type AskThreadSummary, type AutoTopUp, type BulkResult, type AppNotification, type AllowancePolicy, type AllowancePolicyIn, type MembersUsage, type Quote, type NotificationPage, type Invite, type InviteInfo, type JoinableWorkspace, type Me, type MePatch, type OnboardingIn, type SignedIn, type SlugCheck, type Workspace, type WorkspacePatch, type Member, type Role, type Team, type ThreadBulkAction, type Billing, type Checkout, type Invoice, type LedgerEntry, type Overview, type DashboardDraft, type Overlap, type Series, type Signal, type SignalSpec, type Tracker, type TrackerSpec, type UploadOut, type UploadStatus, type Usage,
} from './api-types'
import { saveBlob } from './lib/export'
import { BILLING_ON } from './config'
import { FIREBASE_ON, getIdToken, signOutOfFirebase } from './firebase'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'

/** Told when the backend says there's no session (401), so the app can send the person to sign in.
 *  A 403 stays an error on that one action: the page decides whether to show "no access". */
const signedOut = new Set<() => void>()
export const onSignedOut = (fn: () => void) => (signedOut.add(fn), () => void signedOut.delete(fn))

type Params = Record<string, string | number | boolean | string[] | undefined>

function url(path: string, params: Params = {}) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x)) // repeated, e.g. where=…&where=…
    else if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const qs = q.toString()
  return `${BASE}${path}${qs ? `?${qs}` : ''}`
}

/** FastAPI errors are {detail: string}, {detail: {errors: [...]}} (our 422s and 409s), or
 *  {detail: [{loc, msg}]} (request validation). All become an ApiError with the status. */
async function toError(res: Response): Promise<ApiError> {
  if (res.status === 401) {
    signedOut.forEach((l) => l())
    return new ApiError(import.meta.env.DEV
      ? 'The backend refused the request. Set AFTERCALL_API_KEY in apps/web/.env.local and restart `npm run dev`.'
      : 'Your session has ended. Sign in again.', [], 401)
  }
  const body = await res.json().catch(() => null)
  const detail = body?.detail
  if (typeof detail === 'string') return new ApiError(detail, [], res.status)
  if (Array.isArray(detail?.errors)) return new ApiError(detail.errors.join('. '), detail.errors, res.status)
  if (Array.isArray(detail)) {
    const errors = detail.map((d: { loc?: (string | number)[]; msg: string }) =>
      [d.loc?.filter((l) => l !== 'body').join('.'), d.msg].filter(Boolean).join(': '))
    return new ApiError(errors.join('. '), errors, res.status)
  }
  if (res.status >= 500 && !body) return new ApiError(`The aftercall API didn't answer (HTTP ${res.status}). Is the backend running?`, [], res.status)
  return new ApiError(`Request failed (HTTP ${res.status})`, [], res.status)
}

/** B37: every request is scoped to the open project. Without the header the backend uses the default one. */
let project: string | null = null
export function setProject(id: string | null) {
  project = id
}

async function send(path: string, init: RequestInit = {}, params?: Params): Promise<Response> {
  let res: Response
  try {
    const token = await getIdToken() // refreshed by the SDK; null without Firebase or when signed out
    res = await fetch(url(path, params), {
      credentials: 'include',
      ...init,
      headers: { ...(project ? { 'X-Project': project } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    })
  } catch {
    throw new ApiError(`Can't reach the aftercall API at ${BASE}. Is the backend running?`)
  }
  if (!res.ok) throw await toError(res)
  return res
}

async function json<T>(path: string, init: RequestInit = {}, params?: Params): Promise<T> {
  return (await send(path, init, params)).json() as Promise<T>
}

const body = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

const enc = encodeURIComponent
// SQLite drops the timezone, so stored UTC times come back without one. Mark them as UTC.
const utc = (s: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`)
const withUtc = (u: UploadStatus): UploadStatus => ({ ...u, created_at: utc(u.created_at) })

// ── Trackers and signals ───────────────────────────────────────────────────────

export const listTrackers = () => json<Tracker[]>('/trackers', {}, { include_inactive: true })

/** Another project's trackers, for copying (B37): the header is set for this request only. */
export const listTrackersIn = (project: string) => json<Tracker[]>('/trackers', { headers: { 'X-Project': project } }, { include_inactive: true })

/** A PUT without run_if removes the condition, so callers pass the tracker's current one. */
export const saveTracker = (spec: TrackerSpec, isNew: boolean) =>
  isNew ? json<Tracker>('/trackers', body('POST', spec)) : json<Tracker>(`/trackers/${enc(spec.name)}`, body('PUT', spec))

/** Turns it off. 409 while another tracker's condition depends on it, unless `force`. */
export async function deactivateTracker(name: string, force = false): Promise<void> {
  await send(`/trackers/${enc(name)}`, { method: 'DELETE' }, { force: force || undefined })
}

export const saveSignal = (tracker: string, spec: SignalSpec, isNew: boolean) =>
  isNew
    ? json<Signal>(`/trackers/${enc(tracker)}/signals`, body('POST', spec))
    : json<Signal>(`/trackers/${enc(tracker)}/signals/${enc(spec.name)}`, body('PUT', spec))

export async function deactivateSignal(tracker: string, name: string, force = false): Promise<void> {
  await send(`/trackers/${enc(tracker)}/signals/${enc(name)}`, { method: 'DELETE' }, { force: force || undefined })
}

/** Deletes for good (B5). Past answers are kept, and the name is free again. */
export async function deleteTracker(name: string): Promise<void> {
  await send(`/trackers/${enc(name)}`, { method: 'DELETE' }, { permanent: true })
}

export async function deleteSignal(tracker: string, name: string): Promise<void> {
  await send(`/trackers/${enc(tracker)}/signals/${enc(name)}`, { method: 'DELETE' }, { permanent: true })
}

/** POST /trackers/import: a JSON file of trackers and their signals, all or nothing. */
export function importTrackers(file: File, opts: { dryRun: boolean; onConflict: OnConflict }): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  return json<ImportResult>('/trackers/import', { method: 'POST', body: form }, { dry_run: opts.dryRun, on_conflict: opts.onConflict })
}

/** B37: copies trackers from another project of the account, with the same dry run and conflict rules. */
export const importTrackersFrom = (from: string, trackers: string[], opts: { dryRun: boolean; onConflict: OnConflict }) =>
  json<ImportResult>('/trackers/import', { method: 'POST' }, { from_project: from, trackers: trackers.join(','), dry_run: opts.dryRun, on_conflict: opts.onConflict })

/** GET /overlap: stored answers only, no Jev call. */
export const getOverlap = () => json<Overlap>('/overlap')

/** POST /overlap: asks Jev about pairs not checked yet. Free for the customer. */
export const checkOverlap = () => json<Overlap>('/overlap', { method: 'POST' })

// ── Uploads ────────────────────────────────────────────────────────────────────

function upload(file: File, trackers: string[] | undefined, dry_run: boolean) {
  const form = new FormData()
  form.append('file', file)
  return json<UploadOut>('/uploads', { method: 'POST', body: form }, { dry_run, trackers: trackers?.join(',') })
}

export const dryRun = (file: File, trackers?: string[]) => upload(file, trackers, true)

export async function createUpload(file: File, trackers?: string[]): Promise<string> {
  return (await upload(file, trackers, false)).upload_id!
}

export const getUpload = async (id: string) => withUtc(await json<UploadStatus>(`/uploads/${id}`))

export const listUploads = async () => (await json<UploadStatus[]>('/uploads')).map(withUtc)

export const getResults = (id: string) => json<CallResult[]>(`/uploads/${id}/results`)

export const getCall = (id: string) => json<CallResult>(`/calls/${id}`, {}, { include_transcript: true })

/** Deletes the upload's calls (transcripts and answers) for good. Tokens used stay in usage. */
export async function deleteUpload(id: string): Promise<void> {
  await send(`/uploads/${id}`, { method: 'DELETE' })
}

export async function deleteCall(id: string): Promise<void> {
  await send(`/calls/${id}`, { method: 'DELETE' })
}

/** The endpoint needs the X-API-Key header, so fetch the file and save it rather than link to it. */
export async function downloadExport(id: string): Promise<void> {
  saveBlob(await (await send(`/uploads/${id}/export.csv`)).blob(), `aftercall-upload-${id}.csv`)
}

// ── Usage ──────────────────────────────────────────────────────────────────────

export const getUsage = (start: string, end: string) => json<Usage>('/usage', {}, { start, end })

// ── Insights (B6, B7, B11) ─────────────────────────────────────────────────────

/** The shared scope parameters: lists are comma-separated, `where` and `meta.<key>` repeat. */
function scopeParams(s: InsightScope): Params {
  const p: Params = {
    from: s.from, to: s.to, version: s.version,
    uploads: s.uploads?.join(','), trackers: s.trackers?.join(','),
    channel: s.channel?.join(','), agent_id: s.agent_id?.join(','), agent_version: s.agent_version?.join(','),
    where: s.where,
  }
  for (const [k, vs] of Object.entries(s.meta ?? {})) if (vs.length) p[`meta.${k}`] = vs.join(',')
  return p
}

export const getDimensions = () => json<Dimensions>('/insights/dimensions')

export const getInsights = (scope: InsightScope) => json<Insights>('/insights/signals', {}, scopeParams(scope))

export const listCalls = (scope: InsightScope, q: CallQuery = {}) =>
  json<CallPage>('/calls', {}, { ...scopeParams(scope), needs_review: q.needs_review, limit: q.limit, cursor: q.cursor ?? undefined, sort: q.sort })

/** B8. `signal` left out counts conversations only. */
export const getSeries = (scope: InsightScope, q: { signal?: string; bucket: Bucket }) =>
  json<Series>('/insights/series', {}, { ...scopeParams(scope), signal: q.signal, bucket: q.bucket })

/** B9. `signal` left out counts conversations per group. */
export const getBreakdown = (scope: InsightScope, q: { signal?: string; by: string }) =>
  json<Breakdown>('/insights/breakdown', {}, { ...scopeParams(scope), signal: q.signal, by: q.by })

/** B36: every conversation in scope with its answers, like the upload export. */
export async function exportCalls(scope: InsightScope, filename: string): Promise<void> {
  saveBlob(await (await send('/calls/export.csv', {}, scopeParams(scope))).blob(), filename)
}

// ── Dashboards (B35) ───────────────────────────────────────────────────────────

export const listDashboards = () => json<Dashboard[]>('/dashboards')
export const getDashboard = (id: string) => json<Dashboard>(`/dashboards/${enc(id)}`)
export const createDashboard = (d: DashboardIn) => json<Dashboard>('/dashboards', body('POST', d))
export const saveDashboard = (id: string, d: DashboardIn) => json<Dashboard>(`/dashboards/${enc(id)}`, body('PUT', d))
export async function deleteDashboard(id: string): Promise<void> {
  await send(`/dashboards/${enc(id)}`, { method: 'DELETE' })
}

// ── Projects and the account (B37) ─────────────────────────────────────────────

export const getAccount = () => json<Account>('/account')
export const listProjects = () => json<Project[]>('/projects')
/** 402 when the plan's project limit is reached. */
export const createProject = (p: ProjectIn) => json<Project>('/projects', body('POST', p))
export const updateProject = (id: string, p: ProjectIn) => json<Project>(`/projects/${enc(id)}`, body('PUT', p))
/** Deletes the project and everything in it. 409 for the account's last project. */
export async function deleteProject(id: string): Promise<void> {
  await send(`/projects/${enc(id)}`, { method: 'DELETE' })
}

// ── alteria (B38) ──────────────────────────────────────────────────────────────

/** Raw transcripts (pasted text, or a .txt/.csv/.json/.docx file) → conversations to upload. Nothing is stored. */
export function alteriaConversations(input: { text?: string; file?: File }): Promise<AlteriaConversations> {
  const form = new FormData()
  if (input.file) form.append('file', input.file)
  if (input.text) form.append('text', input.text)
  return json<AlteriaConversations>('/alteria/conversations', { method: 'POST', body: form })
}

/** A goal in plain words → trackers, avoiding names already in the project. */
export const alteriaTrackers = (goal: string, existing: string[]) =>
  json<AlteriaTrackers>('/alteria/trackers', body('POST', { goal, existing }))

/** One question in plain words → a signal for that tracker. `type` is a hint, not a rule. */
export const alteriaSignal = (text: string, tracker: string, type?: string) =>
  json<AlteriaSignal>('/alteria/signal', body('POST', { text, tracker, type }))

/** B39: answers from every conversation in the project, with the conversations it used. B41: the
 *  server keeps the chat, so only `thread_id` goes up (none starts a new chat), plus the dashboard
 *  draft as the user last edited it. */
export const askAlteria = (question: string, scope: InsightScope, threadId?: string, draft?: DashboardDraft) =>
  json<AlteriaAnswer>('/alteria/ask', body('POST', { question, scope, thread_id: threadId, draft }))

// ── Saved chats (B41) ──────────────────────────────────────────────────────────

// SQLite drops the timezone (see `utc` below), so times are marked as UTC on the way in.
const threadUtc = <T extends AskThreadSummary>(t: T): T => ({ ...t, created_at: utc(t.created_at), updated_at: utc(t.updated_at) })

/** Pinned first, then the newest. `q` searches titles and messages. */
export async function listThreads(q?: string): Promise<AskThreadPage> {
  const page = await json<AskThreadPage>('/alteria/threads', {}, { q, limit: 100 })
  return { ...page, threads: page.threads.map(threadUtc) }
}
export async function getThread(id: string): Promise<AskThread> {
  const t = threadUtc(await json<AskThread>(`/alteria/threads/${enc(id)}`))
  return { ...t, messages: t.messages.map((m) => ({ ...m, created_at: utc(m.created_at) })) }
}
export const updateThread = async (id: string, patch: AskThreadPatch) => threadUtc(await json<AskThreadSummary>(`/alteria/threads/${enc(id)}`, body('PATCH', patch)))
export async function deleteThread(id: string): Promise<void> {
  await send(`/alteria/threads/${enc(id)}`, { method: 'DELETE' })
}

/** B43: shares the chat with the whole project team. It can't be undone. */
export const shareThread = async (id: string) => threadUtc(await json<AskThreadSummary>(`/alteria/threads/${enc(id)}/share`, { method: 'POST' }))
/** B43: a private copy of a (shared) chat, with every message so far and its dashboard draft. */
export const copyThread = async (id: string) => threadUtc(await json<AskThreadSummary>(`/alteria/threads/${enc(id)}/copy`, { method: 'POST' }))
/** B44: one request for many chats. Share needs Pro (402 otherwise). */
export const bulkThreads = (ids: string[], action: ThreadBulkAction) => json<BulkResult>('/alteria/threads/bulk', body('POST', { ids, action }))

// ── People (B42) ───────────────────────────────────────────────────────────────

const memberUtc = <T extends Member>(m: T): T => ({ ...m, joined_at: utc(m.joined_at), last_active_at: m.last_active_at && utc(m.last_active_at) })
export const getMe = async () => memberUtc(await json<Me>('/me'))
export const updateMe = async (patch: MePatch) => memberUtc(await json<Me>('/me', body('PATCH', patch)))
export async function getTeam(): Promise<Team> {
  const t = await json<Team>('/team')
  return { ...t, members: t.members.map(memberUtc), invites: t.invites.map((i) => ({ ...i, created_at: utc(i.created_at), expires_at: utc(i.expires_at) })) }
}
/** 402 with a readable message at the plan's teammate limit. */
export const invite = (email: string, role: Invite['role']) => json<Invite>('/team/invites', body('POST', { email, role }))
export const resendInvite = (id: string) => json<Invite>(`/team/invites/${enc(id)}/resend`, { method: 'POST' })
export async function revokeInvite(id: string): Promise<void> {
  await send(`/team/invites/${enc(id)}`, { method: 'DELETE' })
}
export const setRole = async (id: string, role: Exclude<Role, 'owner'>) => memberUtc(await json<Member>(`/team/members/${enc(id)}`, body('PATCH', { role })))
export async function removeMember(id: string): Promise<void> {
  await send(`/team/members/${enc(id)}`, { method: 'DELETE' })
}

const BILLING_OFF: Billing = {
  enabled: false, plan: 'payg', balance: 0, period_start: null, period_end: null, auto_renew: false,
  included_tokens: 0, included_tokens_used: 0, alteria: true, plans: [],
}

// ── Billing (B40) ──────────────────────────────────────────────────────────────

/** The plan, the credits and Pro's included tokens. Also says whether billing is on at all. */
export async function getBilling(): Promise<Billing> {
  if (!BILLING_ON) return BILLING_OFF // this build has no billing: nothing to ask the backend
  const b = await json<Billing>('/billing')
  return { ...b, period_start: b.period_start && utc(b.period_start), period_end: b.period_end && utc(b.period_end) }
}
export async function getLedger(limit = 100): Promise<LedgerEntry[]> {
  return (await json<LedgerEntry[]>('/billing/ledger', {}, { limit })).map((e) => ({ ...e, created_at: utc(e.created_at) }))
}
/** Starts Pro now, with the first month's fee from credits (402 if short, 503 if Pro isn't priced).
 *  On a cancelled Pro, turns renewal back on at no charge. */
export const subscribe = (code?: string) => json<Billing>('/billing/subscribe', body('POST', { plan: 'pro', code }))
/** Pro stays until period_end, then the account is pay as you go. */
export const cancelPlan = () => json<Billing>('/billing/cancel', { method: 'POST' })
/** B47: the provider's checkout for a top-up. Credits arrive by webhook, then show in /billing. */
export const checkout = (amountUsd: number, code?: string) => json<Checkout>('/billing/checkout', body('POST', { amount_usd: amountUsd, code }))
export async function getInvoices(): Promise<Invoice[]> {
  return (await json<Invoice[]>('/billing/invoices')).map((i) => ({ ...i, created_at: utc(i.created_at) }))
}
export const setAutoTopUp = (a: AutoTopUp) => json<Billing>('/billing/auto_top_up', body('PUT', a))

// ── Account overview (B46) ─────────────────────────────────────────────────────

export async function getOverview(): Promise<Overview> {
  const o = await json<Overview>('/account/overview')
  return { ...o, recent: o.recent.map((r) => ({ ...r, at: utc(r.at) })) }
}

// ── Sign-in, onboarding and the workspace (B42, B50) ───────────────────────────
// Sessions are an HttpOnly cookie the backend sets: the page never sees or stores a token.

/** Emails a sign-in link. Always 204, whether or not the address has an account (no account probing). */
export async function requestSignInLink(email: string, next?: string): Promise<void> {
  await send('/auth/magic-link', body('POST', { email, next }))
}
/** Where "Continue with Google" goes: the backend's OAuth start, which comes back to /login/verify. */
export const googleSignInUrl = (next?: string) => url('/auth/google', { next })
/** The token from the emailed link. Sets the session cookie. 400 when it's expired or used. */
export const verifySignIn = (token: string) => json<SignedIn>('/auth/verify', body('POST', { token }))
export async function signOut(): Promise<void> {
  if (FIREBASE_ON) return signOutOfFirebase()
  await send('/auth/logout', { method: 'POST' })
}
export const getInvite = (token: string) => json<InviteInfo>(`/invites/${enc(token)}`)
export const acceptInvite = async (token: string) => memberUtc(await json<Me>(`/invites/${enc(token)}/accept`, { method: 'POST' }))
/** Workspaces the signed-in person may join because of their email's domain. */
export const listJoinable = () => json<JoinableWorkspace[]>('/onboarding/joinable')
export const completeOnboarding = async (o: OnboardingIn) => memberUtc(await json<Me>('/onboarding', body('POST', o)))
export const checkSlug = (slug: string) => json<SlugCheck>(`/workspace/slug/${enc(slug)}`)
export const getWorkspace = () => json<Workspace>('/workspace')
/** Owner and admins only (403 otherwise). 409 when the address is taken. */
export const updateWorkspace = (patch: WorkspacePatch) => json<Workspace>('/workspace', body('PATCH', patch))

// ── Notifications (B52) ────────────────────────────────────────────────────────

export async function listNotifications(opts: { unread?: boolean; cursor?: string } = {}): Promise<NotificationPage> {
  const p = await json<NotificationPage>('/notifications', {}, { unread: opts.unread || undefined, cursor: opts.cursor })
  return { ...p, items: p.items.map((n): AppNotification => ({ ...n, created_at: utc(n.created_at) })) }
}
/** Marks some read, or all of them with `ids` left out. Returns the unread count after. */
export const markNotificationsRead = (ids?: string[]) => json<{ unread: number }>('/notifications/read', body('POST', ids ? { ids } : { all: true }))

// ── Usage by person, allowances (B54) ──────────────────────────────────────────

/** Owner and admins: the workspace and every member. */
export const getMembersUsage = (start: string, end: string) => json<MembersUsage>('/usage/members', {}, { start, end })
/** Anyone who can see usage: the workspace's total and your own line, with your allowance. */
export const getMyUsage = (start: string, end: string) => json<MembersUsage>('/usage/me', {}, { start, end })
/** Owner and admins: the monthly budget, each role's share, and each person's. Runs and questions
 *  past someone's allowance get a 402 `allowance_reached` for them only. */
export const getAllowances = () => json<AllowancePolicy>('/usage/allowances')
export const saveAllowances = (change: AllowancePolicyIn) => json<AllowancePolicy>('/usage/allowances', body('PUT', change))

// ── Discounts (B55, B56) ────────────────────────────────────────────

/** What a top-up or Pro costs with a code (or the running promotion), before paying. */
export const quote = (kind: 'top_up' | 'pro', amountUsd: number, code?: string) => json<Quote>('/billing/quote', body('POST', { kind, amount_usd: amountUsd, code }))

// ── Docs feedback (B65) ────────────────────────────────────────────────────────

/** "Was this helpful?" on a docs article. Public (no sign-in needed); the backend rate-limits it. */
export async function sendDocFeedback(slug: string, helpful: boolean, comment?: string): Promise<void> {
  await send('/docs/feedback', body('POST', { slug, helpful, comment: comment?.trim() || undefined }))
}
