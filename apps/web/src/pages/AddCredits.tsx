// /settings/credits/add: top up credits (B47). Pick an amount, see what it buys from this account's
// own numbers, optionally turn on auto top-up, then pay on the provider's page. The mock has no
// payment page, so its credits arrive at once.
import { ArrowLeft, Check, Lightning, Lock, Tag } from '@phosphor-icons/react'
import { Loader } from '../loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from '../lib/toast'
import { checkout, getUsage, quote, setAutoTopUp, type ApiError } from '../api'
import { setBilling, useBilling } from '../billing'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { num } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { tokensLabel, usd } from '../plans'
import { Num } from '../ui'
import { currencyNote, currencySymbol, displayCurrency, fromLocal, nicePreset, numMoney, toLocal } from '../currency'

const PRESETS = [10, 25, 50, 100]
const MIN = 5
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)

export default function AddCredits() {
  const billing = useBilling().data
  const usage = useLoad(() => getUsage(day(29), day(0)), [])
  // Presets and the custom amount are in the display currency; `value` is USD for the API.
  const presets = PRESETS.map(nicePreset)
  const [amount, setAmount] = useState(presets[1])
  const [custom, setCustom] = useState('')
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState<number>()
  const value = custom ? fromLocal(Number(custom)) : amount
  // The minimum as a clean local amount, like the presets (the backend allows the same rounding).
  const min = nicePreset(MIN)
  const valid = Number.isFinite(value) && value >= min - 1e-6
  // B56: a code, or the running promotion, priced by the backend before paying.
  const [code, setCode] = useState('')
  const [applied, setApplied] = useState<string>()
  const priced = useLoad(() => (valid && billing?.enabled ? quote('top_up', value, applied) : Promise.resolve(null)), [value, applied, billing?.enabled])
  const q = priced.data
  const codeProblem = applied && q?.problem ? q.problem : undefined
  const total = q && !q.problem ? q.total_usd : value

  const plan = billing?.plans.find((p) => p.id === billing.plan)
  const rate = plan?.price_per_million_tokens ?? null
  const t = usage.data?.totals
  const perConversation = t && t.calls_analyzed ? t.billed_input_tokens / t.calls_analyzed : null
  const tokens = rate ? (value / rate) * 1e6 : null

  const pay = async () => {
    setPaying(true)
    try {
      const r = await checkout(value, applied && !codeProblem ? applied : undefined)
      if (r.url) location.href = r.url
      else {
        if (r.billing) setBilling(r.billing)
        setDone(value)
      }
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/settings/credits" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} aria-hidden /> Plan and credits
      </Link>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Add credits</h1>
      <p className="mt-1.5 text-ink-2">
        Runs are charged per token from your credits. {billing?.enabled && <>You have <b className="font-semibold text-foreground">{usd(billing.balance)}</b> now.</>}
      </p>

      {billing && !billing.enabled ? (
        <p className="surface mt-8 px-5 py-4 text-sm text-ink-2"><b className="font-semibold text-foreground">Billing is off.</b> Prices aren’t set yet, so runs don’t use credits and there’s nothing to top up.</p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {done !== undefined ? (
            <motion.section key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease }} className="surface mt-8 flex flex-col items-center px-6 py-10 text-center" aria-live="polite">
              <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.4 }} className="grid size-12 place-items-center rounded-full bg-ok text-white">
                <Check size={24} weight="bold" aria-hidden />
              </motion.span>
              <h2 className="mt-4 text-xl font-semibold tracking-tight">{usd(done)} added</h2>
              <p className="mt-1 text-ink-2">Your balance is now {billing && <Num {...numMoney(billing.balance)} className="font-semibold text-foreground" />}.</p>
              <div className="mt-6 flex gap-2">
                <Button variant="outline" asChild><Link to="/settings/credits">Back to credits</Link></Button>
                <Button asChild><Link to="/analyse">Analyse conversations</Link></Button>
              </div>
            </motion.section>
          ) : (
            <motion.div key="form" exit={{ opacity: 0, transition: { duration: 0.15 } }} className="mt-8 space-y-6">
              <section aria-labelledby="amt-h">
                <h2 id="amt-h" className="mb-2.5 text-sm font-medium">Amount</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Amount">
                  {presets.map((p) => {
                    const on = !custom && amount === p
                    return (
                      <button
                        key={p} role="radio" aria-checked={on} onClick={() => (setAmount(p), setCustom(''))}
                        className={cn('relative isolate h-14 rounded-xl border bg-card text-lg font-semibold tabular-nums transition-[border-color,transform] duration-150 active:scale-[0.97]', on ? 'border-primary text-primary' : 'hover:border-primary/40')}
                      >
                        {on && <motion.span layoutId="amount-pill" className="absolute inset-0 -z-10 rounded-xl bg-primary-soft" transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.15 }} />}
                        {usd(p)}
                      </button>
                    )
                  })}
                  <label className={cn('col-span-2 flex h-14 items-center gap-1 rounded-xl border bg-card px-3 transition-[border-color] focus-within:border-primary sm:col-span-1', custom && 'border-primary')}>
                    <span className="text-lg font-semibold text-muted-foreground">{currencySymbol()}</span>
                    <Input
                      inputMode="decimal" placeholder="Other" value={custom} aria-label={`Another amount, in ${displayCurrency().code}`}
                      onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))}
                      className="h-auto border-0 bg-transparent p-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                    />
                  </label>
                </div>
                {custom && !valid && <p className="mt-2 text-sm text-stop" role="alert">The smallest top-up is {usd(min)}.</p>}
              </section>

              <section className="surface px-5 py-4" aria-labelledby="buys-h">
                <h2 id="buys-h" className="text-sm text-muted-foreground">What {valid ? usd(value) : 'it'} buys</h2>
                {tokens !== null && valid ? (
                  <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">Tokens</dt>
                      <dd className="text-xl font-semibold tracking-tight">About {tokensLabel(tokens)}</dd>
                    </div>
                    {perConversation && (
                      <div>
                        <dt className="text-xs text-muted-foreground">Conversations</dt>
                        <dd className="text-xl font-semibold tracking-tight">About {num(Math.floor(tokens / perConversation))}</dd>
                        <dd className="text-xs text-muted-foreground">at your average of {num(Math.round(perConversation))} tokens each</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-2">{rate === null ? 'The per-token rate isn’t set yet.' : 'Choose an amount.'}</p>
                )}
                {billing?.plan === 'pro' && <p className="mt-3 text-xs text-muted-foreground">At the Pro rate. Credits are only used once this month’s included tokens run out; the Pro subscription itself is billed to your card.</p>}
              </section>

              {billing && <AutoTopUpCard />}

              <section aria-labelledby="code-h">
                <h2 id="code-h" className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Tag size={14} className="text-muted-foreground" aria-hidden /> Discount code</h2>
                <form onSubmit={(e) => (e.preventDefault(), code.trim() && setApplied(code.trim().toUpperCase()))} className="flex max-w-sm gap-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME20" aria-label="Discount code" aria-invalid={!!codeProblem} className="h-9 bg-card font-mono text-[0.875rem] uppercase" />
                  <Button type="submit" variant="outline" disabled={!code.trim() || priced.loading}>{priced.loading && applied ? <Loader /> : 'Apply'}</Button>
                </form>
                {codeProblem && <p role="alert" className="mt-1.5 text-sm text-stop">{codeProblem}</p>}
                <AnimatePresence initial={false}>
                  {q?.discount && !q.problem && (
                    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="rounded bg-ok/12 px-1.5 py-0.5 text-xs font-medium text-ok">{q.discount.code ?? 'Offer'}</span>
                      {q.discount.label}: <b className="font-semibold text-ok tabular-nums">−{usd(q.discount_usd)}</b>
                      {applied && <button type="button" onClick={() => (setApplied(undefined), setCode(''))} className="text-xs text-muted-foreground hover:text-foreground">Remove</button>}
                    </motion.p>
                  )}
                </AnimatePresence>
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock size={13} aria-hidden /> You pay on the payment provider’s secure page, then come back here.</p>
                  {currencyNote() && <p className="text-xs text-muted-foreground">{currencyNote()}</p>}
                  {q?.discount && !q.problem && valid && <p className="text-xs text-muted-foreground">You get {usd(value)} of credits.</p>}
                </div>
                <Button size="lg" onClick={pay} disabled={!valid || paying || !billing}>
                  {paying ? <><Loader /> Opening…</> : <>Pay {valid ? usd(total) : ''}</>}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

/** When credits fall below X, add Y from the saved card, so a big upload never stops for credits. */
function AutoTopUpCard() {
  const billing = useBilling().data!
  const cur = billing.auto_top_up
  const [on, setOn] = useState(!!cur?.enabled)
  // Typed in the display currency, sent in USD.
  const [below, setBelow] = useState(String(toLocal(cur?.below_usd ?? nicePreset(5))))
  const [add, setAdd] = useState(String(toLocal(cur?.amount_usd ?? nicePreset(25))))
  const [saving, setSaving] = useState(false)
  const dirty = on !== !!cur?.enabled || (on && (Number(below) !== toLocal(cur?.below_usd ?? 0) || Number(add) !== toLocal(cur?.amount_usd ?? 0)))
  const save = async () => {
    setSaving(true)
    try {
      setBilling(await setAutoTopUp({ enabled: on, below_usd: fromLocal(Number(below) || 0), amount_usd: fromLocal(Number(add) || 0) }))
      toast.success(on ? 'Auto top-up is on' : 'Auto top-up is off')
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="surface px-5 py-4" aria-labelledby="auto-h">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="auto-h" className="flex items-center gap-1.5 font-medium"><Lightning size={15} weight="fill" className="text-primary" aria-hidden /> Auto top-up</h2>
          <p className="mt-0.5 text-sm text-ink-2">Add credits automatically, so a run never stops for them. Uses the card you pay with.</p>
        </div>
        <Switch checked={on} onCheckedChange={setOn} aria-label="Auto top-up" />
      </div>
      <AnimatePresence initial={false}>
        {on && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
            <p className="flex flex-wrap items-center gap-2 pt-4 text-sm">
              When credits fall below
              <span className="inline-flex items-center gap-0.5">{currencySymbol()}<Input value={below} onChange={(e) => setBelow(e.target.value.replace(/[^\d.]/g, ''))} className="h-8 w-16 text-center" aria-label="Below this balance" inputMode="decimal" /></span>
              add
              <span className="inline-flex items-center gap-0.5">{currencySymbol()}<Input value={add} onChange={(e) => setAdd(e.target.value.replace(/[^\d.]/g, ''))} className="h-8 w-16 text-center" aria-label="Add this much" inputMode="decimal" /></span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {dirty && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="mt-4 flex justify-end">
            <Button size="sm" variant="outline" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save auto top-up'}</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
