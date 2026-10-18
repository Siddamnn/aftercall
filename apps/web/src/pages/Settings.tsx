// /settings: the account in one place (B46). Overview (what the workspace has built and spent),
// Workspace (name, address, joining by domain: B50),
// Profile and Team (B42), Plan and credits (B40, B47), and Usage (it was /usage).
import { BILLING_ON } from '../config'
import { ArrowRight, Buildings, ChartBar, ChatsCircle, Coins, FileText, FolderSimple, Plus, PresentationChart, Pulse, Receipt, SquaresFour, Table, UserCircle, UsersThree, Wallet } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import { getInvoices, getOverview, getTeam, type Overview as OverviewData } from '../api'
import { AvatarStack, useMe } from '../people'
import { can, type Area } from '../access'
import { CreditsPanel, useBilling } from '../billing'
import { Button } from '../components/ui/button'
import { compact, num } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease, rise } from '../lib/motion'
import { cn } from '../lib/utils'
import { planOf, usd } from '../plans'
import { useProjects } from '../projects'
import { ErrorNote, Num, PageHeader } from '../ui'
import { ProfileTab, TeamTab } from './SettingsPeople'
import { WorkspaceTab } from './SettingsWorkspace'
import Usage from './Usage'
import { numMoney } from '../currency'

// `need`: hidden unless the role has it (access.ts). Viewers spend nothing, so see no money or usage.
const TABS: { id: string; label: string; Icon: typeof SquaresFour; need?: Area }[] = [
  { id: '', label: 'Overview', Icon: SquaresFour },
  { id: 'workspace', label: 'Workspace', Icon: Buildings },
  { id: 'profile', label: 'Profile', Icon: UserCircle },
  { id: 'team', label: 'Team', Icon: UsersThree },
  { id: 'credits', label: 'Plan and credits', Icon: Coins, need: 'billing.view' },
  { id: 'usage', label: 'Usage', Icon: ChartBar, need: 'usage.self' },
]

export default function Settings() {
  const { tab = '' } = useParams()
  const role = useMe().data
  const tabs = TABS.filter((t) => (!t.need || can(role, t.need)) && (BILLING_ON || t.id !== 'credits'))
  if (!tabs.some((t) => t.id === tab)) return <Navigate to="/settings" replace />
  return (
    <>
      <PageHeader title="Settings">Your workspace, team and usage.</PageHeader>
      <nav aria-label="Settings" className="-mx-1 mb-8 flex gap-1 overflow-x-auto border-b px-1">
        {tabs.map(({ id, label, Icon }) => (
          <NavLink
            key={id} to={id ? `/settings/${id}` : '/settings'} end
            className={({ isActive }) => cn('relative flex shrink-0 items-center gap-2 px-3 pt-1 pb-3 text-sm font-medium transition-colors duration-150', isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {({ isActive }) => (
              <>
                <Icon size={16} weight={isActive ? 'fill' : 'regular'} className={isActive ? 'text-primary' : ''} aria-hidden />
                {label}
                {isActive && <motion.span layoutId="settings-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.15 }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} {...rise} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
          {tab === '' ? <Overview /> : tab === 'workspace' ? <WorkspaceTab /> : tab === 'profile' ? <ProfileTab /> : tab === 'team' ? <TeamTab /> : tab === 'credits' ? <PlanAndCredits /> : <Usage />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

// ── Overview ───────────────────────────────────────────────────────────────────

const COUNTS: { key: keyof OverviewData['counts']; label: string; to: string; Icon: typeof FolderSimple }[] = [
  { key: 'projects', label: 'Projects', to: '/projects', Icon: FolderSimple },
  { key: 'trackers', label: 'Trackers', to: '/trackers', Icon: Pulse },
  { key: 'dashboards', label: 'Dashboards', to: '/dashboards', Icon: PresentationChart },
  { key: 'conversations', label: 'Conversations analysed', to: '/results', Icon: Table },
  { key: 'chats', label: 'alteria chats', to: '/ask', Icon: ChatsCircle },
  { key: 'members', label: 'Teammates', to: '/settings/team', Icon: UsersThree },
]

const RECENT_ICON = { upload: Table, chat: ChatsCircle, dashboard: PresentationChart, credits: Wallet, plan: Coins } as const

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Overview() {
  const role = useMe().data
  const { account } = useProjects()
  const billing = useBilling().data
  const o = useLoad(getOverview, [])
  const team = useLoad(getTeam, [])
  const plan = billing?.plan ?? account.data?.plan

  return (
    <div className="space-y-8">
      <section className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]" aria-label="Workspace">
        <div className="surface flex items-center gap-4 px-5 py-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground" aria-hidden>
            {account.data?.name.trim()[0]?.toUpperCase() ?? '·'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-tight">{account.data?.name ?? ' '}</p>
            <p className="text-sm text-muted-foreground">{BILLING_ON && (plan ? planOf(plan).name : ' ')}{BILLING_ON && plan !== 'pro' && <> · <Link to="/pricing" className="font-medium text-primary hover:underline">See Pro</Link></>}</p>
            {team.data && (
              <Link to="/settings/team" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                <AvatarStack people={team.data.members} size={22} /> {team.data.members.length} {team.data.members.length === 1 ? 'person' : 'people'}
              </Link>
            )}
          </div>
        </div>
        {BILLING_ON && can(role, 'billing.view') && <div className="surface px-5 py-4">
          <p className="text-sm text-muted-foreground">Credits</p>
          {billing?.enabled ? (
            <div className="mt-1 flex items-end justify-between gap-2">
              <Num {...numMoney(billing.balance)} className={cn('text-2xl font-semibold tracking-tight', billing.balance <= 0 && 'text-stop')} />
              {can(role, 'billing.manage') && <Button size="sm" variant="outline" asChild><Link to="/settings/credits/add"><Plus aria-hidden /> Add</Link></Button>}
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-ink-2">{billing ? 'Billing is off: prices aren’t set yet.' : ' '}</p>
          )}
        </div>}
        {can(role, 'usage.self') && <div className="surface px-5 py-4">
          <p className="text-sm text-muted-foreground">Last 30 days</p>
          {o.data ? (
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {compact(o.data.month.tokens)} <span className="text-sm font-normal text-muted-foreground">tokens</span>
              {o.data.month.spend !== null && <span className="ml-2 text-sm font-normal text-muted-foreground">{usd(o.data.month.spend)}</span>}
            </p>
          ) : <span className="skeleton mt-2 block h-7 w-32 rounded" />}
          {o.data && <p className="text-xs text-muted-foreground">{num(o.data.month.conversations)} conversations analysed</p>}
        </div>}
      </section>

      {o.error && !o.data && <ErrorNote onRetry={o.reload}>Couldn’t load the overview. {o.error}</ErrorNote>}

      <section aria-labelledby="built-h">
        <h2 id="built-h" className="mb-3 text-sm font-medium text-muted-foreground">In this workspace</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {COUNTS.map(({ key, label, to, Icon }, i) => {
            const v = o.data?.counts[key]
            const soon = o.data && v === null
            return (
              <motion.li key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease, delay: i * 0.03 }}>
                <Link to={to} className={cn('surface group flex h-full flex-col gap-2 px-4 py-3.5 transition-[border-color,transform] duration-150 hover:border-primary/40 active:scale-[0.98]', soon && 'pointer-events-none')}>
                  <Icon size={18} className="text-muted-foreground group-hover:text-primary" aria-hidden />
                  {!o.data ? <span className="skeleton h-7 w-12 rounded" /> : soon
                    ? <span className="text-sm font-medium text-muted-foreground">With sign-in</span>
                    : <Num value={v!} className="text-2xl font-semibold tracking-tight" />}
                  <span className="text-xs text-muted-foreground">{label}</span>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
        {!o.data ? (
          <div className="skeleton h-40 rounded-xl" />
        ) : o.data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Analyse some conversations, or ask alteria a question.</p>
        ) : (
          <ul className="surface divide-y">
            {o.data.recent.map((r, i) => {
              const Icon = RECENT_ICON[r.kind]
              const body = (
                <>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon size={15} aria-hidden /></span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(r.at)}</span>
                  {r.href && <ArrowRight size={13} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
                </>
              )
              return (
                <li key={i}>
                  {r.href
                    ? <Link to={r.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">{body}</Link>
                    : <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── Plan and credits ───────────────────────────────────────────────────────────

function PlanAndCredits() {
  const billing = useBilling().data
  const invoices = useLoad(getInvoices, [billing?.balance])
  return (
    <div className="space-y-8">
      <CreditsPanel />
      {billing?.enabled && !(invoices.error && !invoices.data) && (
        <section aria-labelledby="inv-h">
          <h2 id="inv-h" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><Receipt size={14} aria-hidden /> Invoices</h2>
          {!invoices.data ? <div className="skeleton h-20 rounded-xl" /> : invoices.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet. Every top-up and Pro fee gets one.</p>
          ) : (
            <div className="surface overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {['Invoice', 'Date', 'For', 'Amount', ''].map((h, i) => <th key={i} scope="col" className={cn('px-4 py-2.5 font-medium', i === 3 && 'text-right')}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {invoices.data.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-mono text-[0.8125rem] font-normal">{inv.id}</th>
                      <td className="px-4 py-2.5">{new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="px-4 py-2.5 text-ink-2">{inv.kind === 'top_up' ? 'Credits' : 'Pro'}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{usd(inv.amount)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {inv.pdf_url
                          ? <a href={inv.pdf_url} className="inline-flex items-center gap-1 text-primary hover:underline"><FileText aria-hidden /> PDF</a>
                          : <span className="text-xs text-muted-foreground">PDF soon</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
