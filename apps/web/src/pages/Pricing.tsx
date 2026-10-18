// /pricing: prepaid credits and the two plans (B40), how a run is priced, the full comparison,
// and questions. The words come from src/plans.ts; every number comes from GET /billing, so a
// price shows only once the backend has one.
import { ArrowRight, CaretRight, Check, Coins, GitBranch, Info, ListChecks, Minus, Scales, Tag } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast, Toaster } from 'sonner'
import { subscribe, type ApiError, type Billing, type BillingPlan } from '../api'
import { AlteriaMark } from '../alteria-mark'
import { Wordmark } from '../brand'
import { setBilling, useBilling } from '../billing'
import { currencyNote } from '../currency'
import { ConfirmAction } from '../confirm-action'
import { Button } from '../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { FEATURES, PLANS, rateLabel, tokensLabel, usd, type Plan, type PlanId } from '../plans'
import { useTheme } from '../theme'
import { ThemeButton } from '../ui'
import { toasterProps } from '../lib/toast'

export default function Pricing() {
  const billing = useBilling().data
  const current = billing?.enabled ? billing.plan : undefined
  const theme = useTheme()
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <div className="min-h-dvh overflow-x-clip">
      <Toaster {...toasterProps(dark)} />
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="aftercall home"><Wordmark /></Link>
          <nav className="flex items-center gap-1 text-sm" aria-label="Site">
            <Link to="/" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block">Home</Link>
            <a href="#how" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block">How it runs</a>
            <a href="#compare" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground md:block">Compare</a>
            <ThemeButton className="ml-1" />
            <Button asChild className="ml-2"><Link to="/insights">Open the app</Link></Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="dot-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="mx-auto max-w-6xl px-4 pt-14 pb-10 text-center sm:px-6 lg:pt-20">
            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Load credits.<br className="hidden sm:block" /> Pay for the tokens you analyse.</h1>
            <p className="mx-auto mt-4 max-w-[58ch] text-lg text-ink-2">
              Every run is charged per token from prepaid credits: the transcript plus the signals you chose. No seats, no fee per question. New accounts start with a trial credit.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6" aria-label="Plans">
          {billing?.promotion && (
            <motion.p
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="mx-auto mb-6 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 rounded-full border border-primary/25 bg-primary-soft px-4 py-1.5 text-sm text-primary"
            >
              <Tag size={14} weight="fill" aria-hidden /> <b className="font-semibold">{billing.promotion.label}</b>
              {billing.promotion.ends_at && <span className="text-primary/80">until {new Date(billing.promotion.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
            </motion.p>
          )}
          <ul className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
            {PLANS.map((p, i) => <PlanCard key={p.id} p={p} i={i} billing={billing} />)}
          </ul>
          <p className="mt-4 text-center text-sm text-muted-foreground">Both plans show the tokens and cost of a run before it starts, and hold only what it can use.</p>
          {currencyNote() && <p className="mt-1 text-center text-xs text-muted-foreground">{currencyNote()} Prices are set for your region.</p>}
        </section>

        <HowItRuns />
        <Compare current={current} />
        <Faq />

        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Start with the trial credit, on your own conversations.</h2>
              <p className="mt-1 text-ink-2">Or try the sample file: no transcripts of your own needed.</p>
            </div>
            <Button size="lg" asChild><Link to="/analyse">Analyse conversations <ArrowRight weight="bold" aria-hidden /></Link></Button>
          </div>
        </section>
      </main>
    </div>
  )
}

function PlanCard({ p, i, billing }: { p: Plan; i: number; billing?: Billing }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const priced: BillingPlan | undefined = billing?.plans.find((x) => x.id === p.id)
  const featured = p.id === 'pro'
  const here = billing?.enabled && billing.plan === p.id
  const fee = priced?.monthly_fee
  const rate = rateLabel(priced)
  const sellable = p.id === 'payg' || (fee != null && priced?.price_per_million_tokens != null)
  const choose = () => {
    if (p.id === 'payg' || !billing?.enabled) return navigate(p.id === 'payg' ? '/settings/credits/add' : '/analyse')
    setConfirm(true)
  }
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease, delay: i * 0.06 }}
      className={cn('relative flex flex-col rounded-2xl border bg-card p-6 shadow-panel', featured && 'border-primary/50 ring-1 ring-primary/40')}
    >
      {featured && <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">For teams</span>}
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{p.name}</h2>
        {here && <span className="rounded-md bg-ok-soft px-1.5 py-0.5 text-xs font-medium text-ok">Your plan</span>}
      </div>
      <p className="mt-1 text-sm text-ink-2">{p.tagline}</p>
      <p className="mt-5 flex items-baseline gap-1.5">
        {p.id === 'payg' ? (
          <span className="text-4xl font-semibold tracking-[-0.03em]">No fee</span>
        ) : fee != null ? (
          <><span className="text-4xl font-semibold tracking-[-0.03em]">{usd(fee)}</span><span className="text-sm text-muted-foreground">a month</span></>
        ) : (
          <span className="text-2xl font-semibold tracking-[-0.03em]">Price soon</span>
        )}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Coins size={14} aria-hidden />
        {p.id === 'pro' && priced?.included_tokens ? `${tokensLabel(priced.included_tokens)} tokens a month included, then ` : ''}
        {rate ?? 'Per-token rate soon'}
      </p>
      <Button className="mt-6" size="lg" variant={featured ? 'default' : 'outline'} onClick={choose} disabled={here || !sellable}>
        {here ? 'Current plan' : !sellable ? 'Coming soon' : p.cta}
      </Button>
      <ul className="mt-6 space-y-2.5 text-sm">
        {p.highlights.map((h) => {
          const lead = h.endsWith(':')
          const soon = h.includes('(soon)')
          return (
            <li key={h} className={cn('flex gap-2', lead && 'font-medium text-muted-foreground')}>
              {!lead && (h.toLowerCase().includes('alteria')
                ? <AlteriaMark size={15} className="mt-0.5 text-primary" />
                : <Check size={15} weight="bold" className={cn('mt-0.5 shrink-0', soon ? 'text-muted-foreground' : 'text-primary')} aria-hidden />)}
              <span className={soon ? 'text-ink-2' : ''}>
                {h.replace(' (soon)', '')}
                {soon && <span className="ml-1.5 rounded bg-muted px-1 text-[0.6875rem] font-medium text-muted-foreground">Soon</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {p.id === 'pro' && (
        <ConfirmAction
          open={confirm}
          onOpenChange={setConfirm}
          title="Start Pro?"
          action="Start Pro"
          onConfirm={async () => {
            try {
              setBilling(await subscribe())
              toast.success('You’re on Pro', { action: { label: 'See credits', onClick: () => navigate('/settings/credits') } })
            } catch (e) {
              // 402 (not enough credits) and 503 (not priced) are written for customers.
              throw new Error((e as ApiError).message)
            }
          }}
        >
          Pro is a monthly subscription{fee != null ? ` of ${usd(fee)}` : ''}, billed to your card. Each month brings its included tokens and every Pro feature; top up credits for anything above them. Cancel any time.
        </ConfirmAction>
      )}
    </motion.li>
  )
}

// ── How a run is priced ────────────────────────────────────────────────────────

function HowItRuns() {
  const steps: { Icon: typeof Coins; t: string; b: string }[] = [
    { Icon: ListChecks, t: 'You choose the trackers', b: 'A tracker groups signals: the questions you ask, like “Did they book?”. You pick which trackers run on each upload, and only their active signals count.' },
    { Icon: Scales, t: 'One pass per conversation', b: 'Each conversation is read once, with all its signals together (up to 15 per pass; more add a pass). A model built for precise questions gives each one a typed answer, and how sure it is.' },
    { Icon: GitBranch, t: 'Conditions skip what isn’t needed', b: 'A tracker can run only when another answer says so, like reasons only when they declined. Skipped trackers use no tokens.' },
    { Icon: Coins, t: 'Tokens, shown before you run', b: 'You pay for the transcript plus the signals’ own short definitions, in tokens. A dry run shows the total first. Conversations over 30,000 tokens are skipped and not charged.' },
  ]
  return (
    <section id="how" className="scroll-mt-16 border-t bg-card/50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-[-0.035em]">How trackers and signals run</h2>
        <p className="mt-2 max-w-[62ch] text-ink-2">Asking more is cheap: another signal adds only its own definition to a pass that's happening anyway. That's why there's no fee per question on any plan.</p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ Icon, t, b }, i) => (
            <motion.li key={t} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.35, ease, delay: i * 0.06 }} className="rounded-xl border bg-card p-5">
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground tabular-nums">
                <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary"><Icon size={17} weight="duotone" aria-hidden /></span>
                Step {i + 1}
              </span>
              <h3 className="mt-3 font-semibold tracking-tight">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{b}</p>
            </motion.li>
          ))}
        </ol>
        <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
          <AlteriaMark size={16} className="mt-0.5 text-primary" />
          alteria (setup help and Ask alteria) runs on a separate language model and never adds to the token count of your runs.
        </p>
      </div>
    </section>
  )
}

// ── Comparison ─────────────────────────────────────────────────────────────────

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check size={16} weight="bold" className="mx-auto text-primary" aria-label="Included" />
  if (v === false) return <Minus size={16} className="mx-auto text-muted-foreground/60" aria-label="Not included" />
  return <span className="text-sm">{v}</span>
}

function Compare({ current }: { current?: PlanId }) {
  return (
    <section id="compare" className="scroll-mt-16 border-t">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-[-0.035em]">Compare every feature</h2>
        <p className="mt-2 text-ink-2">Anything marked <span className="rounded bg-muted px-1 text-xs font-medium">Soon</span> is on the way, and comes with the plan when it ships.</p>
        {/* Scrolls sideways only on phones: a scroll container would pin the sticky header inside it. */}
        <div className="mt-8 overflow-x-auto rounded-xl border bg-card md:overflow-x-visible">
          <table className="w-full min-w-[34rem] text-left">
            <thead className="z-10 bg-card md:sticky md:top-16 [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
              <tr className="border-b">
                <th scope="col" className="w-2/5 px-4 py-3 text-sm font-medium text-muted-foreground">Feature</th>
                {PLANS.map((p) => (
                  <th key={p.id} scope="col" className="px-4 py-3 text-center">
                    <span className="block font-semibold">{p.name}</span>
                    {current === p.id && <span className="text-xs font-medium text-ok">Your plan</span>}
                  </th>
                ))}
              </tr>
            </thead>
            {FEATURES.map((g) => (
              <tbody key={g.group}>
                <tr><th colSpan={3} scope="colgroup" className="bg-muted/50 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.group}</th></tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-t">
                    <th scope="row" className="px-4 py-3 text-sm font-normal">
                      <span className="inline-flex items-center gap-1.5">
                        {r.label}
                        {r.soon && <span className="rounded bg-muted px-1 text-[0.6875rem] font-medium text-muted-foreground">Soon</span>}
                        {r.hint && (
                          <Tooltip>
                            <TooltipTrigger asChild><button className="text-muted-foreground hover:text-foreground" aria-label={`About ${r.label}`}><Info size={13} aria-hidden /></button></TooltipTrigger>
                            <TooltipContent className="max-w-60">{r.hint}</TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </th>
                    {(['payg', 'pro'] as const).map((k) => <td key={k} className="px-4 py-3 text-center text-ink-2"><Cell v={r[k]} /></td>)}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </section>
  )
}

// ── Questions ──────────────────────────────────────────────────────────────────

const FAQ: [string, string][] = [
  ['How do credits work?', 'You load credits before you analyse. When you upload conversations, their estimated tokens are held from your credits. Each conversation is then charged for the tokens it actually used, and the rest of its hold comes back. If your credits can’t cover an upload, nothing is uploaded, and you’re told how much to add.'],
  ['What is a token?', 'A small piece of text, about three quarters of a word. A run uses the tokens in the transcript plus the short definition of each signal you chose. The dry run counts them before anything runs.'],
  ['Does adding more signals cost more?', 'A little: each one adds its definition, usually a few dozen tokens, to a pass that happens anyway. There is no fee per question or per field.'],
  ['What counts as a conversation?', 'One call or chat, of any length up to 30,000 tokens. Longer ones are flagged and skipped, and not charged.'],
  ['What does Pro add?', 'A monthly allowance of tokens, a lower rate for tokens above it, alteria (converting transcripts, drafting trackers and signals, and Ask alteria), more projects, unlimited teammates, sharing chats with your team, and bulk export. It’s a monthly subscription, billed to your card; the included tokens reset each month.'],
  ['Do I pay per teammate?', 'No, on either plan. Pay as you go includes 3 people who can ask and analyse; Pro has no limit. Viewers, who read Insights, dashboards and shared chats, are free on both, because they don’t spend credits.'],
  ['Who sees my alteria chats?', 'Only you, until you share one. On Pro you can share a chat with everyone in the project: they read it and can carry on in their own private copy. Sharing can’t be undone. Any chat can be exported as Markdown or PDF on either plan.'],
  ['What if my credits run out on Pro?', 'Pro itself keeps going: it’s billed to your card each month, and brings a fresh set of included tokens. Credits only pay for usage beyond those tokens, so when they run out, runs over the allowance wait until you top up (or auto top-up does). If you cancel, or the card payment fails, the account moves to pay as you go at the end of the month. Your projects, trackers and results stay as they are.'],
  ['Where is my data kept, and who sees it?', 'Only your account can see its conversations. alteria uses model providers that don’t train on what you send.'],
]

function Faq() {
  return (
    <section className="border-t bg-card/50">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
        <h2 className="text-3xl font-semibold tracking-[-0.035em]">Questions</h2>
        <ul className="divide-y rounded-xl border bg-card">
          {FAQ.map(([q, a]) => (
            <li key={q}>
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium">
                  {q}
                  <CaretRight size={14} weight="bold" className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden />
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <p className="px-5 pb-4 text-ink-2">{a}</p>
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
