// /dev/flows: every flow in the UI, one click away, for testing on the mock. Only in mock builds
// (main.tsx adds the route when VITE_API_MOCK=true), so it never ships.
import { ArrowSquareOut, ArrowsClockwise } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { AuthShell } from '../auth-shell'
import { Button } from '../components/ui/button'
import { AlteriaLoader, Loader, LogoLoader } from '../loaders'
import { useBilling } from '../billing'
import { planOf } from '../plans'

type Flow = { label: string; href: string; note?: string }
const GROUPS: { title: string; hint?: string; flows: Flow[] }[] = [
  {
    title: 'Sign-in',
    flows: [
      { label: 'Signed out: the app sends you to sign in', href: '/insights?signed-out', note: 'Then “Email me a sign-in link” → “Open the link (mock)”' },
      { label: 'Create an account', href: '/signup?signed-out' },
      { label: 'Continue with Google', href: '/login?signed-out', note: 'The mock goes straight to the verify page' },
      { label: 'Session ran out mid-visit', href: '/login?expired=1&next=/dashboards' },
      { label: 'An expired sign-in link', href: '/login/verify?token=expired' },
      { label: 'Signed in, landing on /login', href: '/login', note: 'Goes straight to the app' },
      { label: 'Sign out', href: '/settings', note: 'Account menu (bottom left) → Sign out' },
    ],
  },
  {
    title: 'Onboarding',
    hint: 'Signs in as alex@sunriseclinic.example, who is new.',
    flows: [
      { label: 'Join your company’s workspace by email domain', href: '/onboarding?onboarding' },
      { label: 'Create a new workspace', href: '/onboarding?onboarding', note: 'Pick “Create a new workspace”. Type “acme” for a taken address' },
      { label: 'Nobody can join by domain', href: '/settings/workspace', note: 'Turn off “Join by email domain”, then open onboarding again' },
    ],
  },
  {
    title: 'Invites',
    flows: [
      { label: 'An invite for someone else’s address', href: '/invite/demo', note: 'You’re Sam; the invite is for Jordan' },
      { label: 'Accept an invite (signed out first)', href: '/invite/demo?signed-out' },
      { label: 'An expired or revoked invite', href: '/invite/nope' },
      { label: 'Invite teammates, hit the 3-seat limit (free plan)', href: '/settings/team' },
    ],
  },
  {
    title: 'Workspace and roles',
    flows: [
      { label: 'Rename the workspace, change its address', href: '/settings/workspace' },
      { label: 'As an admin', href: '/settings/workspace?role=admin' },
      { label: 'As a member (reads only)', href: '/settings/workspace?role=member' },
      { label: 'As a viewer (can’t ask alteria)', href: '/ask?role=viewer' },
      { label: 'An empty workspace, first run', href: '/insights?fresh' },
    ],
  },
  {
    title: 'Plans and Pro gates',
    hint: 'Run ./start.sh --free (:5173) and ./start.sh --pro (:5174) to compare. On the free plan these are gated.',
    flows: [
      { label: 'Plan and credits, the ledger, invoices', href: '/settings/credits' },
      { label: 'Add credits', href: '/settings/credits/add' },
      { label: 'Pricing page', href: '/pricing' },
      { label: 'Ask alteria: 3 free questions, then Pro', href: '/ask' },
      { label: 'Share a chat, export many chats (.zip)', href: '/ask', note: 'Chat menu → Share; Select → Export' },
      { label: 'Every conversation as CSV', href: '/insights', note: 'Export → Conversations as CSV' },
      { label: 'A whole dashboard as CSV', href: '/dashboards', note: 'Open one → Export → Every chart as CSV' },
      { label: 'Project limit', href: '/projects' },
      { label: 'Billing off (prices not set yet)', href: '/settings/credits?billing=off' },
      { label: 'Start Pro from here (this browser only)', href: '/settings/credits?plan=pro' },
    ],
  },
  {
    title: 'Roles: what each one sees',
    hint: 'The backend decides (me.permissions); the page only hides. A role stays until you open another ?role= link or reset.',
    flows: [
      { label: 'Owner: everything, usage by person, allowances', href: '/settings/usage?role=owner' },
      { label: 'Member: read-only credits, own usage and allowance', href: '/settings/credits?role=member' },
      { label: 'Member: their usage next to the workspace’s', href: '/settings/usage?role=member' },
      { label: 'Viewer: no Analyse, Trackers, credits or usage', href: '/insights?role=viewer' },
      { label: 'Viewer opens a hidden page', href: '/analyse?role=viewer' },
    ],
  },
  {
    title: 'Currency, prices, discounts',
    hint: 'Amounts are USD underneath; the page shows the visitor’s currency. ?currency=auto goes back to your time zone.',
    flows: [
      { label: 'Prices in rupees (India, 0.6 regional price)', href: '/pricing?currency=INR' },
      { label: 'Prices in euros', href: '/settings/credits/add?currency=EUR' },
      { label: 'Back to your own currency', href: '/pricing?currency=auto' },
      { label: 'A code at checkout: WELCOME20, NAMASTE10 (India), BETA50 (ended)', href: '/settings/credits/add' },
    ],
  },
  {
    title: 'Allowances, sessions, upgrade',
    flows: [
      { label: 'Allowances: role shares, per person, confirm', href: '/settings/usage/allowances?role=owner' },
      { label: 'A member can’t open allowances', href: '/settings/usage/allowances?role=member' },
      { label: 'A viewer asks alteria', href: '/ask?role=viewer' },
      { label: 'Session warning and sign-out in 6 minutes (resumes the page)', href: '/login?signed-out&session=360', note: 'Sign in, open any page, wait a minute for the warning' },
      { label: 'Upgrade popup after sign-in (free plan)', href: '/login?signed-out' },
    ],
  },
  {
    title: 'Docs',
    flows: [
      { label: 'Docs home: search inside every article', href: '/docs' },
      { label: 'An article with “On this page”', href: '/docs/glossary' },
      { label: 'A legal draft', href: '/privacy' },
    ],
  },
  {
    title: 'Notifications',
    flows: [
      { label: 'The bell: 3 unread', href: '/insights', note: 'A new one arrives about 40 s in, with a toast' },
      { label: 'No notifications', href: '/insights?quiet' },
      { label: 'Email notification settings', href: '/settings/profile' },
    ],
  },
  {
    title: 'Analyse and results',
    flows: [
      { label: 'Try the sample file', href: '/analyse' },
      { label: 'Upload a plain-text or subtitle transcript', href: '/analyse', note: '.txt, .vtt and .srt are accepted now (B51)' },
      { label: 'Results, review queue, export CSV', href: '/results' },
    ],
  },
  {
    title: 'Status pages',
    flows: [
      { label: 'Not found (404)', href: '/this-page-is-not-here' },
      { label: 'No access (403)', href: '/unauthorized' },
      { label: 'Signed out (401)', href: '/signed-out' },
      { label: 'Something broke (500)', href: '/dev/crash' },
    ],
  },
]

/** Clears everything the mock saved in this browser (keeps the theme). */
function reset() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('mock-') || ['project', 'sidebar', 'ask-trial-used'].includes(k)) localStorage.removeItem(k)
  } catch {
    // Nothing saved.
  }
  location.assign('/dev/flows')
}

export default function DevFlows() {
  const b = useBilling().data
  return (
    <AuthShell wide footer={false}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground uppercase">mock · {b ? (b.enabled ? planOf(b.plan).name : 'billing off') : '…'} · :{location.port}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Every flow</h1>
          <p className="mt-1 text-ink-2">Each link opens the flow on mock data. URL switches like <code className="font-mono text-[0.85em]">?signed-out</code> stick until you reset.</p>
        </div>
        <Button variant="outline" onClick={reset}><ArrowsClockwise aria-hidden /> Reset mock data</Button>
      </div>

      <section className="mt-8 surface flex flex-wrap items-center gap-6 px-5 py-4" aria-label="Loaders">
        <a href="/dev/loaders" className="text-sm font-medium text-primary hover:underline">All loaders →</a>
        <span className="flex items-center gap-2 text-sm text-ink-2"><Loader className="text-primary" /> Loader</span>
        <span className="flex items-center gap-2 text-sm text-ink-2"><LogoLoader size={36} /> Logo loader</span>
        <span className="flex items-center gap-2 text-sm text-ink-2"><AlteriaLoader className="text-primary" /> alteria</span>
      </section>

      <div className="mt-8 space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={`g-${g.title}`}>
            <h2 id={`g-${g.title}`} className="text-sm font-semibold">{g.title}</h2>
            {g.hint && <p className="mt-0.5 text-sm text-ink-2">{g.hint}</p>}
            <ul className="mt-2 surface divide-y">
              {g.flows.map((f) => <Row key={f.label + f.href} f={f} />)}
            </ul>
          </section>
        ))}
      </div>
    </AuthShell>
  )
}

function Row({ f }: { f: Flow }): ReactNode {
  return (
    <li>
      {/* A full load, so URL switches read at start-up take effect. */}
      <a href={f.href} className="group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{f.label}</span>
          {f.note && <span className="block text-xs text-ink-2">{f.note}</span>}
        </span>
        <code className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">{f.href}</code>
        <ArrowSquareOut size={14} className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </a>
    </li>
  )
}

/** /dev/crash: throws, to see the error page. */
export function Crash(): ReactNode {
  throw new Error('A test crash from /dev/crash')
}
