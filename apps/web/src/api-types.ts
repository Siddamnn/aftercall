// The API types the UI uses, shared by the HTTP client and the mock. They mirror
// apps/backend/aftercall/api.py, which says trackers and signals like the UI (request B4).

export type SignalType = 'choice' | 'yes_no' | 'score'
export type Criteria = Record<string, string> | string[]

export interface SignalSpec {
  name: string
  type: SignalType
  instructions: string
  criteria?: Criteria
  review_threshold?: number
}

export interface Signal {
  tracker: string
  name: string
  active: boolean
  version: number
  /** Tokens this signal adds to every request it's sent in. */
  tokens: number
  spec: SignalSpec
}

/** Run a tracker only when another tracker's signal answered a certain way. `in` / `not_in`
 *  take choice option keys, or "yes" / "no"; `gte` / `lte` take a score. */
export type ConditionOp = 'in' | 'not_in' | 'gte' | 'lte'
export interface Condition {
  tracker: string
  signal: string
  op: ConditionOp
  value: string[] | number
}

export interface TrackerSpec {
  name: string
  description?: string | null
  /** Leaving it out of a PUT removes the condition, so edits send the current one back. */
  run_if?: Condition | null
}

export interface Tracker {
  name: string
  description: string | null
  active: boolean
  run_if: Condition | null
  /** Tokens the tracker's active signals add to every call it runs on. */
  signal_tokens: number
  signals: Signal[]
  /** From the last overlap check: trackers that overlap share a colour. Null if none or unchecked. */
  color: string | null
  overlaps_with: string[]
}

export interface Flagged {
  row: number
  external_id: string | null
  flag: 'large' | 'over_limit'
  transcript_tokens: number
  requests: number
  estimated_tokens: number
  multiplier: number | null
  message: string
}

export interface Estimate {
  requests: number
  /** Null (or missing) for audio: the transcript doesn't exist yet, so there is nothing to count. */
  tokens: number | null
  price_per_million_tokens: number | null
  cost: number | null
}

export interface UploadOut {
  upload_id: string | null
  dry_run: boolean
  filename: string
  trackers: string[]
  /** The chosen trackers that have a condition. With any, the estimate is an upper bound. */
  conditional: string[]
  signals: number
  received: number
  queued: number
  over_limit: number
  large: number
  duplicates: number
  estimate: Estimate
  over_limit_message: string | null
  flagged: Flagged[]
  /** B40: what the upload holds from the account. Null (or missing) while billing is off. */
  charge?: Charge | null
}

/** B40: queued calls hold their estimate, from Pro's included tokens first, then credits. Each call
 *  is charged what it actually used when it runs, and the rest comes back. Amounts in USD. */
export interface Charge {
  plan: PlanId
  included_tokens: number
  cost: number
  balance: number
  balance_after: number
  /** 0 when the balance covers it. Otherwise a real upload is refused (402). */
  shortfall: number
  /** What to do about a shortfall, written for the customer: show it word for word. */
  message: string | null
}

/** `transcribing`: an audio file Gemini is still turning into a transcript, before it is queued for Jev. */
export type CallStatus = 'transcribing' | 'queued' | 'processing' | 'done' | 'failed' | 'over_limit'

export interface UploadStatus {
  upload_id: string
  filename: string
  trackers: string[]
  created_at: string
  complete: boolean
  counts: Record<Exclude<CallStatus, 'transcribing'>, number> & { transcribing?: number }
}

export interface Answer {
  type: SignalType
  value: string | number
  probability_yes?: number
  confidence: number
  needs_review: boolean
  probabilities: Record<string, number>
  /** An opaque id of the signal version the answer was made with; `version_number` (when sent) is the integer to show. */
  signal_version: string
  version_number?: number
}

/** {tracker: {signal: Answer}} */
export type Answers = Record<string, Record<string, Answer>>

/** Whether a conditional tracker ran on a call. `reason` says why not; null when it ran. */
export interface ConditionCheck {
  run_if: Condition
  condition: string
  met: boolean
  value: string | number | null
  reason: string | null
}

export interface CallResult {
  call_id: string
  external_id: string | null
  agent_id: string | null
  agent_version: string | null
  started_at: string | null
  trackers: string[]
  status: CallStatus
  message: string | null
  tokens: { transcript: number; billed_input: number; output: number }
  requests: number
  estimate: { requests: number | null; tokens: number | null; cost: number | null }
  cost: number | null
  large: boolean
  warning: string | null
  model: string | null
  answers: Answers
  /** Keyed by conditional tracker. A tracker that didn't run has no key in `answers`. */
  conditions: Record<string, ConditionCheck>
  transcript?: string
  /** B6: `call`, `chat`, `email`, `voice_agent`…; null when the upload didn't say. Optional until B6 lands. */
  channel?: string | null
  /** B6: the upload's own fields (rep, team, campaign…). */
  metadata?: Record<string, string>
}

export interface UsageDay {
  date: string
  calls_analyzed: number
  jev_requests: number
  billed_input_tokens: number
  output_tokens: number
  over_limit_calls: number
  over_limit_tokens: number
  cost: number | null
}

export interface Usage {
  pricing: { unit: string; price: number | null }
  token_budget: number
  days: UsageDay[]
  totals: Omit<UsageDay, 'date'>
}

export interface OverlapPair {
  a: string
  b: string
  /** true: they overlap; false: mutually exclusive. */
  overlaps: boolean
  probability: number
  confidence: number
  cached: boolean
}

export interface Overlap {
  trackers: Record<string, { group: number | null; color: string | null; overlaps_with: string[] }>
  pairs: OverlapPair[]
  /** Pairs with no answer for their current definitions (GET only). */
  unchecked: [string, string][]
  asked: number
  billed: false
}

// ── Insights (B6, B7, B11; see docs/insights-plan.md) ─────────────────────────

/** The slice every Insights number follows. Arrays are OR-ed, fields AND-ed. `where` entries
 *  are `<tracker>.<signal>:<value>` (a score takes `gte:2` / `lte:1`). */
export interface InsightScope {
  from?: string
  to?: string
  uploads?: string[]
  trackers?: string[]
  channel?: string[]
  agent_id?: string[]
  agent_version?: string[]
  meta?: Record<string, string[]>
  where?: string[]
  version?: 'all' | 'current'
}

/** GET /insights/dimensions (B6): what the scope bar can offer. */
export interface Dimensions {
  channels: string[]
  agents: { agent_id: string; versions: string[] }[]
  metadata: Record<string, string[]>
  /** [first, last] date with a conversation, or null when there are none. */
  date_range: [string, string] | null
  truncated?: boolean
}

/** One signal's answers over a scope. `counts` keys are option keys, yes/no, or score levels. */
export interface SignalInsight {
  tracker: string
  signal: string
  type: SignalType
  versions: Record<string, number>
  current_version: number
  /** Calls its tracker ran on, and calls where a condition kept it from running. */
  ran: number
  not_run: number
  answered: number
  counts: Record<string, number>
  mean: number | null
  levels: Record<string, string> | null
  /** 10 equal bins over 0–1, and the signal's review threshold. */
  confidence: { mean: number; bins: number[]; threshold: number }
  needs_review: number
}

/** GET /insights/signals (B7). */
export interface Insights {
  scope: { calls: number; calls_previous: number | null; answers: number; needs_review: number; tokens: number; cost: number | null }
  signals: SignalInsight[]
}

/** GET /calls (B11): calls across uploads, without transcripts. */
export interface CallPage {
  calls: CallResult[]
  next_cursor: string | null
  total: number
}

export interface CallQuery {
  needs_review?: boolean
  limit?: number
  cursor?: string | null
  sort?: 'started_at' | '-started_at' | 'confidence'
}

/** GET /insights/series (B8). Without `signal`, points only count conversations (`calls`). */
export interface SeriesPoint {
  start: string
  calls: number
  answered: number
  counts: Record<string, number>
  mean: number | null
  needs_review: number
}
export interface SeriesEvent { at: string; kind: 'signal_version' | 'agent_version'; label: string }
export interface Series {
  signal: string | null
  type: SignalType | null
  bucket: Bucket
  points: SeriesPoint[]
  events: SeriesEvent[]
}
export type Bucket = 'day' | 'week'

/** GET /insights/breakdown (B9). Without `signal`, groups only count conversations (`answered` = calls). */
export interface BreakdownGroup { key: string; answered: number; counts: Record<string, number>; mean: number | null }
export interface Breakdown {
  signal: string | null
  by: string
  groups: BreakdownGroup[]
  other: { answered: number; counts: Record<string, number> }
  missing: number
}

// ── Dashboards (B35) ──────────────────────────────────────────────────────────

export type ChartKind = 'kpi' | 'donut' | 'bar' | 'column' | 'table' | 'line' | 'stacked' | 'compare' | 'heatmap' | 'confidence'

/** One chart on a dashboard. The backend stores widgets as given; only the UI reads them. */
export interface Widget {
  id: string
  kind: ChartKind
  /** `<tracker>.<signal>`, or `conversations` for volume. */
  metric: string
  /** The answer a KPI or trend line follows (`yes`, an option key). Scores use the mean. */
  value?: string
  /** Compare and heatmap: `channel`, `agent_id`, `agent_version`, `meta.<key>` or `<tracker>.<signal>`. */
  by?: string
  /** Trend charts; left out, it follows the time range. */
  bucket?: Bucket
  /** Columns it spans on a wide screen: 1, 2 or 3. */
  size: 1 | 2 | 3
  /** A name the user typed; left out, the UI names it. */
  title?: string
}

export interface Dashboard {
  id: string
  name: string
  description: string | null
  /** The saved view: Insights scope parameters as a query string (`range=30&channel=chat`). */
  params: string
  widgets: Widget[]
  created_at: string
  updated_at: string
}

export type DashboardIn = Pick<Dashboard, 'name' | 'description' | 'params' | 'widgets'>

// ── Projects and the account (B37) ─────────────────────────────────────────────

/** A workspace: its own trackers, uploads, conversations, insights and dashboards. */
export interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
  counts: { trackers: number; signals: number; conversations: number; dashboards: number }
}
export type ProjectIn = Pick<Project, 'name' | 'description'>

/** B40: pay as you go, or Pro (a monthly fee from credits, with included tokens and alteria). */
export type PlanId = 'payg' | 'pro'

export interface Account {
  name: string
  plan: PlanId
  /** Projects the plan allows; null = no limit. */
  project_limit: number | null
  projects: number
}

// ── alteria's built-in AI (B38) ────────────────────────────────────

/** One conversation as the upload takes it (ingest.py CallIn, plus channel and metadata from B6). */
export interface CallDraft {
  external_id?: string
  agent_id?: string
  agent_version?: string
  started_at?: string
  channel?: string
  metadata?: Record<string, string>
  transcript: { speaker: string; text: string }[] | string
}
/** POST /alteria/conversations: raw transcripts in any format → the upload's JSON. */
export interface AlteriaConversations { calls: CallDraft[]; warnings: string[] }

export interface TrackerDraft { name: string; description?: string; signals: SignalSpec[] }
/** POST /alteria/trackers: a goal in plain words → trackers to import. */
export interface AlteriaTrackers { trackers: TrackerDraft[]; notes: string[] }
/** POST /alteria/signal: one question in plain words → a signal spec. */
export interface AlteriaSignal { signal: SignalSpec; notes: string[] }

/** POST /alteria/ask (B39): a question about the project's conversations. */
export interface AlteriaAnswer {
  /** Markdown-light: **bold** and "- " bullets. */
  text: string
  /** The conversations the answer comes from; the UI opens them in the call panel. */
  citations: { call_id: string; external_id: string | null; why: string }[]
  /** A chart that shows the answer, as a dashboard widget plus any extra filter. */
  chart?: { widget: Widget; where?: string[] }
  follow_ups: string[]
  /** Set when the signals can't answer it: the question to turn into a new signal. */
  suggest_signal?: string
  /** "Build me a dashboard for…": a whole dashboard to preview, change by chatting, and save. */
  dashboard?: DashboardDraft
  /** B41: the saved chat this answer went into (created on the first question), and its title. */
  thread_id?: string
  message_id?: string
  title?: string
}

/** B41: a saved Ask alteria chat, as the sidebar lists it. Private to its user, per project. */
export interface AskThreadSummary {
  id: string
  title: string
  pinned: boolean
  created_at: string
  updated_at: string
  message_count: number
  /** The start of the last question, for search results and tooltips. */
  preview: string | null
  /** B43: who started it. `mine` is relative to whoever is asking. */
  owner?: Person
  mine?: boolean
  /** B43: set once it's shared with the project team. Sharing can't be undone. */
  shared_at?: string | null
  /** B43: a private copy of a teammate's shared chat says where it came from. */
  copied_from?: { id: string; title: string; by: Person } | null
}
export interface AskThreadPage { threads: AskThreadSummary[]; next: string | null }
export interface AskMessage {
  id: string
  role: 'user' | 'alteria'
  text: string
  /** The answer as it was given, so charts, citations and follow-ups come back on resume. */
  answer?: AlteriaAnswer
  /** Set when the answer failed; the question is still kept. */
  error?: string
  scope: InsightScope
  created_at: string
}
/** GET /alteria/threads/{id}: the whole chat, with the dashboard draft it left open. */
export interface AskThread extends AskThreadSummary {
  messages: AskMessage[]
  draft: DashboardDraft | null
  saved_dashboard_id: string | null
}
/** B44: POST /alteria/threads/bulk. Partial success is normal: every id lands in one list. */
export type ThreadBulkAction = 'delete' | 'pin' | 'unpin' | 'share'
export interface BulkResult { done: string[]; failed: { id: string; detail: string }[] }

/** PATCH /alteria/threads/{id}. */
export interface AskThreadPatch { title?: string; pinned?: boolean; draft?: DashboardDraft | null; saved_dashboard_id?: string | null }

export interface DashboardDraft { name: string; description: string | null; widgets: Widget[] }

// ── People (B42) ───────────────────────────────────────────────────────────────

export type Role = 'owner' | 'admin' | 'member' | 'viewer'
/** Someone in the workspace, as other screens show them: a name and an avatar. */
export interface Person { id: string; name: string; avatar_url: string | null }
export interface Member extends Person {
  email: string
  role: Role
  joined_at: string
  last_active_at: string | null
}
/** `link`: nobody is emailed. The inviter shares this link; opening it signs the person in and joins them. */
export interface Invite { id: string; email: string; role: Exclude<Role, 'owner'>; invited_by: Person; created_at: string; expires_at: string; link: string }
/** GET /team: members, open invites, and the plan's limit (null = no limit). Invites count. */
export interface Team { members: Member[]; invites: Invite[]; limit: number | null }
/** GET /me: who is signed in. */
export interface Me extends Member {
  /** B54: what this person may do, decided by the backend from their role. The page only hides what
   *  isn't listed; the backend refuses it anyway (403) and leaves it out of responses. */
  permissions?: string[]
  /** When this sign-in ends (B64): sessions last 5 hours, then the person signs in again. The backend
   *  refuses the session after it, whatever the page does. */
  session_expires_at?: string
  /** False until the person finishes /onboarding (a new account, before it has a workspace). */
  onboarded?: boolean
  sign_in: { email: boolean; google: boolean }
  notifications: { low_balance: boolean; weekly_digest: boolean; shared_chats: boolean; run_finished: boolean }
}
export interface MePatch { name?: string; notifications?: Partial<Me['notifications']> }

// ── Sign-in, onboarding and the workspace (B42, B50) ──────────────────────────

/** The workspace: one company or team, with its own people, projects, plan and credits. */
export interface Workspace {
  id: string
  name: string
  /** Its address: aftercall.app/{slug}. Lowercase letters, digits and dashes, 3 to 40. */
  slug: string
  logo_url: string | null
  /** Email domains whose people may join without an invite, e.g. ["sunriseclinic.com"]. Verified by the backend. */
  allowed_domains: string[]
  /** Whether people with an allowed domain can join on their own, and as what. */
  join_by_domain: boolean
  default_role: 'member' | 'viewer'
}
export type WorkspacePatch = Partial<Pick<Workspace, 'name' | 'slug' | 'allowed_domains' | 'join_by_domain' | 'default_role'>>
/** GET /workspace/slug/{slug}: whether an address is free, with a free one near it when it isn't. */
export interface SlugCheck { slug: string; available: boolean; suggestion: string | null }
/** A workspace a new person can join because of their email's domain. */
export interface JoinableWorkspace { slug: string; name: string; logo_url: string | null; members: number; role: 'member' | 'viewer' }
/** GET /invites/{token}: what an invite link offers, before signing in. */
export interface InviteInfo { workspace: Pick<Workspace, 'name' | 'slug' | 'logo_url'>; invited_by: Person; email: string; role: Exclude<Role, 'owner'>; expires_at: string }
/** POST /auth/verify: the magic link worked; the session cookie is set. `new_user` goes to onboarding. */
export interface SignedIn { me: Me; new_user: boolean }
export type UseCase = 'sales' | 'support' | 'voice_agents' | 'chat' | 'other'
/** POST /onboarding: everything a new account sets up in one go. Either join a workspace or create one. */
export interface OnboardingIn {
  name: string
  join?: string
  workspace?: Pick<Workspace, 'name' | 'slug' | 'allowed_domains' | 'join_by_domain'>
  use_case?: UseCase
  invites?: { email: string; role: Exclude<Role, 'owner'> }[]
}

// ── Notifications (B52) ────────────────────────────────────────────────────────

export type NotificationKind =
  | 'run_finished' | 'run_failed' | 'low_balance' | 'credits_added' | 'plan_renewing'
  | 'chat_shared' | 'invite_accepted' | 'member_joined' | 'role_changed' | 'alert'
  /** B66: your allowance is 80% used, or used up. Links to Settings → Usage (none for viewers). */
  | 'allowance_warning' | 'allowance_reached'
/** One thing that happened, for one person. `href` opens what it's about. */
export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  href: string | null
  actor: Person | null
  project_id: string | null
  created_at: string
  read: boolean
}
/** GET /notifications: newest first, one page, and how many are unread across all of them. */
export interface NotificationPage { items: AppNotification[]; unread: number; next_cursor: string | null }

/** B48: what the plan allows, so gates read one place and not the plan's name. */
export interface PlanFeatures { share_chats: boolean; bulk_export: boolean; import_documents: boolean; audit_log: boolean }
export interface PlanLimits {
  teammates: number | null
  projects: number | null
  /** Free Ask alteria questions left on pay as you go; null on Pro. The backend counts and enforces it (B49). */
  alteria_trial_left?: number | null
}

/** One plan as the backend prices it (B40). Prices are null until they're set. */
export interface BillingPlan {
  id: PlanId
  name: string
  monthly_fee: number | null
  /** A month. */
  included_tokens: number
  /** For tokens beyond the included ones. */
  price_per_million_tokens: number | null
  alteria: boolean
}

/** GET /billing (B40): the plan, the prepaid credits, and Pro's included tokens this period. */
export interface Billing {
  /** False until prices are set; then calls need credits to run. */
  enabled: boolean
  plan: PlanId
  /** Credits, in USD. */
  balance: number
  period_start: string | null
  period_end: string | null
  /** False: Pro was cancelled and ends at period_end. */
  auto_renew: boolean
  included_tokens: number
  included_tokens_used: number
  /** Whether the plan includes alteria. */
  alteria: boolean
  plans: BillingPlan[]
  /** B47: add credits automatically. Null until the backend has it, or no card is saved. */
  auto_top_up?: AutoTopUp | null
  /** B48: the current plan's features and limits. */
  features?: PlanFeatures
  limits?: PlanLimits
  /** B55: the currency to show, from the visitor's location or the workspace's choice. Amounts stay USD. */
  currency?: DisplayCurrency
  /** B56: a running promotion, shown on Pricing and Add credits. Null when there's none. */
  promotion?: Promotion | null
}

/** B55: show amounts as `usd * rate` in `code`. The provider charges in it at the same rate. */
export interface DisplayCurrency { code: string; rate: number; country: string | null; source: 'geo' | 'workspace' | 'default' }

/** B56: a discount. `percent_off` or `amount_off_usd`, on top-ups, the Pro fee, or both. */
export interface Discount {
  id: string
  /** What people type, e.g. LAUNCH20. Null for an automatic promotion that needs no code. */
  code: string | null
  label: string
  percent_off: number | null
  amount_off_usd: number | null
  applies_to: ('top_up' | 'pro')[]
  /** Only for these countries (ISO codes); empty = everywhere. */
  countries: string[]
  starts_at: string | null
  ends_at: string | null
  max_redemptions: number | null
  redemptions: number
  /** Only new workspaces (their first payment). */
  first_payment_only: boolean
  active: boolean
}
export type DiscountIn = Omit<Discount, 'id' | 'redemptions'>
/** What visitors see of a promotion that needs no code. */
export type Promotion = Pick<Discount, 'label' | 'percent_off' | 'amount_off_usd' | 'applies_to' | 'ends_at'>

/** POST /billing/quote: what a payment will cost after a discount, before paying. */
export interface Quote { kind: 'top_up' | 'pro'; subtotal_usd: number; discount_usd: number; total_usd: number; credits_usd: number; discount: Pick<Discount, 'code' | 'label'> | null; problem: string | null }

/** The internal admin API (B56): the prices every workspace sees, in USD. Never called by the customer app. */
export interface PricingConfig {
  payg_per_million: number
  pro_monthly_fee: number
  pro_per_million: number
  pro_included_tokens: number
  trial_credit_usd: number
  min_top_up_usd: number
  /** Regional prices: a multiplier on the USD prices for a country, e.g. IN 0.6. */
  regions: { country: string; currency: string; multiplier: number }[]
  updated_at: string | null
  updated_by: string | null
}

// ── Usage by person (B54) ──────────────────────────────────────────────────────

/** B54: how much of the workspace's monthly budget each person may use. Owners and admins have no
 *  limit; members and viewers get their role's share (0 to 1) unless they have their own. */
export interface AllowancePolicy {
  /** What the shares are of: a fixed monthly amount, or the credits the workspace had when the month began. */
  budget: { basis: 'balance' | 'fixed'; monthly_usd: number | null; effective_usd: number }
  roles: { member: number; viewer: number }
  people: { member: Person & { role: Role; email: string }; override: number | null; effective_usd: number | null; used_usd: number }[]
  resets_at: string
}
export interface AllowancePolicyIn {
  budget?: { basis: 'balance' | 'fixed'; monthly_usd: number | null }
  roles?: Partial<AllowancePolicy['roles']>
  /** Per person: a share (0 to 1), or null to go back to their role's. */
  overrides?: Record<string, number | null>
}

/** A monthly spending allowance: the person's effective limit and what they've used. Null = no limit. */
export interface Allowance { monthly_usd: number | null; used_usd: number; resets_at: string }
/** One person's usage over a range, with their allowance. */
export interface MemberUsage {
  member: Person & { role: Role; email: string }
  tokens: number
  spend: number | null
  conversations: number
  alteria_questions: number
  allowance: Allowance
}
/** GET /usage/members: everyone (owner and admins). GET /usage/me: just you, and the workspace total. */
export interface MembersUsage { start: string; end: string; workspace: { tokens: number; spend: number | null; conversations: number }; members: MemberUsage[] }

/** B47: when credits fall below `below_usd`, add `amount_usd` from the saved card. */
export interface AutoTopUp { enabled: boolean; below_usd: number; amount_usd: number }

/** POST /billing/checkout (B47): the payment provider's page, or null when credits were added at once (the mock). */
export interface Checkout { url: string | null; billing: Billing | null }

/** GET /billing/invoices (B47): a receipt for every top-up and Pro fee. */
export interface Invoice { id: string; amount: number; kind: 'top_up' | 'subscription'; created_at: string; pdf_url: string | null }

/** GET /account/overview (B46): what the workspace has built and spent. */
export interface Overview {
  counts: { projects: number; trackers: number; dashboards: number; conversations: number; chats: number; members: number | null }
  month: { tokens: number; spend: number | null; conversations: number }
  recent: { kind: 'upload' | 'chat' | 'dashboard' | 'credits' | 'plan'; text: string; at: string; href: string | null }[]
}

export type LedgerKind = 'trial' | 'top_up' | 'subscription' | 'plan_end' | 'hold' | 'settle' | 'release'
/** GET /billing/ledger: every change to the credits, newest first. */
export interface LedgerEntry {
  id: string
  kind: LedgerKind
  /** + credits in, − credits out, in USD. */
  amount: number
  balance_after: number
  /** Pro's included tokens taken (+) or given back (−). */
  included_tokens: number
  upload_id: string | null
  call_id: string | null
  /** Written for customers. */
  note: string | null
  created_at: string
}

export type OnConflict = 'fail' | 'skip' | 'update'

export interface ImportResult {
  dry_run: boolean
  created: string[]
  updated: string[]
  skipped: string[]
  signals_created: number
  signals_updated: number
  signals_unchanged: number
  trackers: Tracker[]
  overlap: Overlap | null
  overlap_error: string | null
}

export class ApiError extends Error {
  errors: string[]
  /** The HTTP status, when the backend answered. 409 = a conflict the user can act on. */
  status?: number
  constructor(message: string, errors: string[] = [], status?: number) {
    super(message)
    this.errors = errors
    this.status = status
  }
}

/** Calls over this many tokens aren't run (the backend's TOKEN_BUDGET). */
export const TOKEN_BUDGET = 30_000

/** Stand-in for the backend's tokens.question_tokens(spec.to_jev()): what a signal will add to
 *  each call, before it's saved (the API reports `tokens` after). */
export const estimateTokens = (spec: SignalSpec) => Math.ceil(JSON.stringify(spec).length / 4) + 12
