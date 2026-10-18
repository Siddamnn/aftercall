// Credits and the plan (B40): one shared copy of GET /billing for every screen that shows the
// balance or gates on the plan, the Credits panel on Usage, and the ledger.
import { ArrowDown, ArrowUp, Coins, Lightning, Plus, Receipt } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { toast } from './lib/toast'
import { cancelPlan, getBilling, getLedger, subscribe, type ApiError, type Billing, type LedgerEntry } from './api'
import { ConfirmAction } from './confirm-action'
import { Button } from './components/ui/button'
import { useLoad } from './lib/hooks'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { planOf, tokensLabel, usd } from './plans'
import { Num } from './ui'
import { numMoney, setDisplayCurrency } from './currency'
import { useCan } from './access'

// ── The shared store ───────────────────────────────────────────────────────────

let state: { data?: Billing; error?: string } = {}
let pending: Promise<void> | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function load() {
  pending ??= getBilling().then(
    (data) => {
      setDisplayCurrency(data.currency)
      state = { data }
    },
    (e: Error) => void (state = { ...state, error: e.message }),
  ).finally(() => {
    pending = undefined
    emit()
  })
  return pending
}

/** Replace the shared copy with a fresh one from a billing response (subscribe, cancel, top-up). */
export const setBilling = (data: Billing) => {
  setDisplayCurrency(data.currency)
  state = { data }
  emit()
}
export const reloadBilling = () => load()

/** GET /billing, shared. `undefined` data while loading, or when the backend has no /billing yet. */
export function useBilling() {
  const snap = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => state)
  useEffect(() => {
    if (!state.data) void load()
  }, [])
  return snap
}

/** Whether alteria is open to this account: always while billing is off, else when the plan includes it. */
export const alteriaIncluded = (b?: Billing) => !b || !b.enabled || b.alteria

// ── Credits panel ──────────────────────────────────────────────────────────────

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function CreditsPanel({ className }: { className?: string }) {
  const { data: b, error } = useBilling()
  // Members see the workspace's credits and plan; only the owner and admins pay or change the plan.
  const manage = useCan('billing.manage')
  const [busy, setBusy] = useState<'pro' | 'cancel'>()
  const [confirm, setConfirm] = useState<'pro' | 'cancel'>()
  const ledger = useLoad(() => getLedger(20), [b?.balance, b?.plan, b?.auto_renew])

  if (error && !b) return null // no /billing on this backend yet
  if (!b) return <div className={cn('skeleton h-44 rounded-xl', className)} aria-busy="true" />
  if (!b.enabled) {
    return (
      <section className={cn('surface flex items-start gap-3 px-5 py-4', className)} aria-label="Credits">
        <Coins size={20} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-ink-2">
          <b className="font-semibold text-foreground">Billing is off.</b> Prices aren't set yet, so runs don't use credits.
          Once they are, you load credits and each run is charged per token from them.
        </p>
      </section>
    )
  }

  const pro = b.plans.find((p) => p.id === 'pro')
  const onPro = b.plan === 'pro'
  const run = async (what: 'pro' | 'cancel', fn: () => Promise<Billing>, done: string) => {
    setBusy(what)
    try {
      setBilling(await fn())
      toast.success(done)
    } finally {
      setBusy(undefined)
    }
  }
  // The backend's 402 and 503 messages are written for customers: show them as they are.
  const orToast = (p: Promise<void>) => p.catch((e: ApiError) => toast.error(e.message))
  const usedShare = b.included_tokens ? Math.min(1, b.included_tokens_used / b.included_tokens) : 0

  return (
    <section className={className} aria-labelledby="credits-h">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="surface px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="credits-h" className="text-sm text-muted-foreground">Credits</h2>
          </div>
          <p className={cn('mt-1 text-[2.5rem] leading-none font-semibold tracking-[-0.04em]', b.balance <= 0 && 'text-stop')}>
            <Num {...numMoney(b.balance)} />
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {b.balance <= 0 ? 'Add credits to analyse more conversations.' : 'Each run holds its estimate from here, and is charged what it actually used.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {manage
              ? <Button size="sm" asChild><Link to="/settings/credits/add"><Plus aria-hidden /> Add credits</Link></Button>
              : <span className="text-xs text-muted-foreground">The workspace’s credits. The owner and admins add them.</span>}
            {b.auto_top_up?.enabled && (
              <span className="text-xs text-muted-foreground">Auto top-up: {usd(b.auto_top_up.amount_usd)} when below {usd(b.auto_top_up.below_usd)}</span>
            )}
          </div>
        </div>

        <div className="surface px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm text-muted-foreground">Plan</h3>
            {onPro && b.period_end && (
              <span className="text-xs text-muted-foreground">{b.auto_renew ? `Renews ${date(b.period_end)}` : `Ends ${date(b.period_end)}`}</span>
            )}
          </div>
          <p className="mt-1 text-xl font-semibold tracking-tight">{planOf(b.plan).name}</p>
          {onPro ? (
            <>
              <div className="mt-3 flex items-baseline justify-between text-sm">
                <span className="tabular-nums"><b className="font-medium">{tokensLabel(b.included_tokens_used)}</b> of {tokensLabel(b.included_tokens)} included tokens</span>
                <span className="text-muted-foreground tabular-nums">{Math.round(usedShare * 100)}%</span>
              </div>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <motion.span className={cn('block h-full origin-left rounded-full', usedShare >= 1 ? 'bg-warn' : 'bg-primary')} initial={{ scaleX: 0 }} animate={{ scaleX: usedShare }} transition={{ duration: 0.5, ease }} />
              </span>
              <p className="mt-2 text-xs text-muted-foreground">Tokens above that are charged from credits at the Pro rate.</p>
              <div className="mt-3">
                {!manage ? null : b.auto_renew ? (
                  <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" onClick={() => setConfirm('cancel')} disabled={!!busy}>Cancel Pro</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => orToast(run('pro', subscribe, 'Pro will renew'))} disabled={!!busy}>
                    {busy === 'pro' ? 'Turning on…' : 'Keep Pro'}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-2">
                Pro includes tokens every month, a lower rate above them, and alteria.
                {pro?.monthly_fee != null && <> It's a {usd(pro.monthly_fee)} monthly subscription, billed to your card.</>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {manage && pro?.monthly_fee != null && (
                  <Button size="sm" onClick={() => setConfirm('pro')} disabled={!!busy}><Lightning weight="fill" aria-hidden /> Start Pro</Button>
                )}
                <Button size="sm" variant="outline" asChild><Link to="/pricing">Compare plans</Link></Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Ledger rows={ledger.data} loading={ledger.loading} />

      <ConfirmAction
        open={confirm === 'pro'}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title="Start Pro?"
        action="Start Pro"
        onConfirm={() => run('pro', subscribe, 'You’re on Pro')}
      >
        Pro is a subscription: {pro?.monthly_fee != null ? usd(pro.monthly_fee) : 'its fee'} a month, billed to your card. Each month you get its included tokens and every Pro feature; top up credits for anything above that. Cancel any time.
      </ConfirmAction>
      <ConfirmAction
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title="Cancel Pro?"
        action="Cancel Pro"
        destructive
        onConfirm={() => run('cancel', cancelPlan, 'Pro won’t renew')}
      >
        Pro stays until {b.period_end ? date(b.period_end) : 'the end of this month'}, then you're on pay as you go and your card isn't charged again. Your credits stay. You can keep Pro before then.
      </ConfirmAction>
    </section>
  )
}

// ── Ledger ─────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  trial: 'Trial credit', top_up: 'Top-up', subscription: 'Pro', plan_end: 'Plan change', hold: 'Held for a run', settle: 'Run charged', release: 'Returned',
}

function Ledger({ rows, loading }: { rows?: LedgerEntry[]; loading: boolean }) {
  if (!rows) return loading ? <div className="skeleton mt-3 h-24 rounded-xl" /> : null
  if (!rows.length) return null
  return (
    <section className="mt-6" aria-labelledby="ledger-h">
      <h3 id="ledger-h" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Receipt size={14} aria-hidden /> Credit history
      </h3>
      <ul className="surface mt-2 divide-y">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li key={r.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', r.amount > 0 ? 'bg-ok-soft text-ok' : r.amount < 0 ? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground')}>
                {r.amount > 0 ? <ArrowDown size={13} weight="bold" aria-hidden /> : <ArrowUp size={13} weight="bold" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.note ?? KIND_LABEL[r.kind]}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {r.included_tokens !== 0 && ` · ${tokensLabel(Math.abs(r.included_tokens))} included tokens ${r.included_tokens > 0 ? 'used' : 'back'}`}
                </span>
              </span>
              <span className="text-right tabular-nums">
                <span className={cn('block font-medium', r.amount > 0 && 'text-ok')}>{r.amount === 0 ? '—' : `${r.amount > 0 ? '+' : '−'}${usd(Math.abs(r.amount))}`}</span>
                <span className="text-xs text-muted-foreground">{usd(r.balance_after)} left</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  )
}
