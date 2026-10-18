// Settings → Usage → Allowances (B54): how much of the workspace's monthly budget each person may
// use. Out of the gate: members 50% and viewers 25% (viewers only spend on alteria), owners and admins
// no limit. Owners and admins change the share per role, or per person, with a slider or a number,
// and see every change in a confirmation before it's saved. The backend enforces them (402).
import { ArrowLeft, ArrowRight, ArrowCounterClockwise, Warning } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from '../lib/toast'
import { getAllowances, saveAllowances, type AllowancePolicy, type AllowancePolicyIn, type ApiError } from '../api'
import { useCan } from '../access'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Slider } from '../components/ui/slider'
import { Switch } from '../components/ui/switch'
import { currencySymbol, fromLocal, toLocal } from '../currency'
import { Loader } from '../loaders'
import { money } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Avatar, roleLabel } from '../people'
import { ErrorNote, PageHeader, Segmented } from '../ui'
import { Forbidden } from './Status'

const pct = (share: number) => `${Math.round(share * 100)}%`
const PRESETS = [0.1, 0.25, 0.5, 0.75, 1]

/** A share of the budget: a slider, a number box and quick picks, kept in step. Shows the amount. */
function ShareControl({ id, value, onChange, budget, label }: { id: string; value: number; onChange: (v: number) => void; budget: number; label: string }) {
  const [text, setText] = useState<string>()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Slider
        aria-label={label} min={0} max={100} step={1} value={[Math.round(value * 100)]}
        onValueChange={([v]) => (setText(undefined), onChange(v / 100))} className="min-w-40 flex-1"
      />
      <span className="flex items-center gap-1">
        <Input
          id={id} inputMode="numeric" aria-label={`${label}, percent`} value={text ?? String(Math.round(value * 100))}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d]/g, '').slice(0, 3)
            setText(t)
            if (t !== '') onChange(Math.min(100, Number(t)) / 100)
          }}
          onBlur={() => setText(undefined)} className="h-8 w-14 text-right tabular-nums"
        />
        <span className="text-sm text-muted-foreground">%</span>
      </span>
      <span className="w-28 text-sm text-ink-2 tabular-nums">≈ {money(budget * value)}<span className="text-xs text-muted-foreground"> /mo</span></span>
      <span className="flex basis-full gap-1">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => (setText(undefined), onChange(p))}
            className={cn('rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors', Math.round(value * 100) === p * 100 ? 'border-primary bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {pct(p)}
          </button>
        ))}
      </span>
    </div>
  )
}

type Draft = { basis: 'balance' | 'fixed'; fixed: string; roles: AllowancePolicy['roles']; overrides: Record<string, number | null> }
const draftOf = (p: AllowancePolicy): Draft => ({
  basis: p.budget.basis,
  fixed: p.budget.monthly_usd ? String(toLocal(p.budget.monthly_usd)) : '',
  roles: { ...p.roles },
  overrides: Object.fromEntries(p.people.map((x) => [x.member.id, x.override])),
})

export default function Allowances() {
  const allowed = useCan('usage.members')
  const loaded = useLoad(() => (allowed ? getAllowances() : Promise.resolve(null)), [allowed])
  const [policy, setPolicy] = useState<AllowancePolicy>()
  const p = policy ?? loaded.data ?? undefined
  const [draft, setDraft] = useState<Draft>()
  const d = draft ?? (p ? draftOf(p) : undefined)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const budget = !p || !d ? 0 : d.basis === 'fixed' ? fromLocal(Number(d.fixed) || 0) : p.budget.basis === 'balance' ? p.budget.effective_usd : p.budget.effective_usd
  const shareFor = (id: string, role: string) => (role === 'owner' || role === 'admin' ? null : d?.overrides[id] ?? d?.roles[role === 'viewer' ? 'viewer' : 'member'] ?? 0)

  // Every difference from what's saved, in words, for the confirmation.
  const changes = useMemo(() => {
    if (!p || !d) return []
    const out: { what: string; from: string; to: string; warn?: string }[] = []
    const was = p.budget.basis === 'fixed' ? `${money(p.budget.monthly_usd ?? 0)} fixed` : 'Credits at the start of the month'
    const now = d.basis === 'fixed' ? `${money(fromLocal(Number(d.fixed) || 0))} fixed` : 'Credits at the start of the month'
    if (was !== now) out.push({ what: 'Monthly budget', from: was, to: now })
    for (const r of ['member', 'viewer'] as const) {
      if (Math.round(p.roles[r] * 100) !== Math.round(d.roles[r] * 100)) {
        const n = p.people.filter((x) => x.member.role === r && d.overrides[x.member.id] == null).length
        out.push({ what: `${roleLabel(r)}s (role default)`, from: pct(p.roles[r]), to: `${pct(d.roles[r])} · ${n === 0 ? 'no one uses the default now' : `${n} ${n === 1 ? 'person' : 'people'}`}` })
      }
    }
    for (const x of p.people) {
      const before = x.override
      const after = d.overrides[x.member.id] ?? null
      const cap = shareFor(x.member.id, x.member.role)
      const over = cap !== null && x.used_usd > cap * budget
      if ((before === null) !== (after === null) || (before !== null && after !== null && Math.round(before * 100) !== Math.round(after * 100))) {
        out.push({
          what: x.member.name, from: before === null ? 'Role default' : pct(before), to: after === null ? 'Role default' : pct(after),
          warn: over ? `Has used ${money(x.used_usd)} this month, over the new ${money((cap ?? 0) * budget)}. Their runs and questions wait until the month resets.` : undefined,
        })
      } else if (over && out.some((c) => c.what.startsWith(roleLabel(x.member.role as 'member')))) {
        out.push({ what: x.member.name, from: 'Role default', to: 'Role default', warn: `Has used ${money(x.used_usd)} this month, over the new ${money((cap ?? 0) * budget)}.` })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, d, budget])

  if (!allowed) return <Forbidden inline />
  if (loaded.error && !p) return <ErrorNote onRetry={loaded.reload}>Couldn’t load allowances. {loaded.error}</ErrorNote>
  if (!p || !d) return <div className="space-y-3"><div className="skeleton h-40 rounded-xl" /><div className="skeleton h-72 rounded-xl" /></div>

  const set = (fn: (x: Draft) => Draft) => setDraft(fn(structuredClone(d)))
  const fixedBad = d.basis === 'fixed' && !(Number(d.fixed) > 0)

  const save = async () => {
    setSaving(true)
    const change: AllowancePolicyIn = {
      budget: { basis: d.basis, monthly_usd: d.basis === 'fixed' ? fromLocal(Number(d.fixed)) : null },
      roles: d.roles,
      overrides: Object.fromEntries(p.people.filter((x) => (x.override ?? null) !== (d.overrides[x.member.id] ?? null)).map((x) => [x.member.id, d.overrides[x.member.id] ?? null])),
    }
    try {
      const next = await saveAllowances(change)
      setPolicy(next)
      setDraft(undefined)
      setConfirming(false)
      toast.success('Allowances saved. They apply from the next run or question.')
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  const people = p.people.filter((x) => x.member.role === 'member' || x.member.role === 'viewer')

  return (
    <div className="pb-24">
      <Link to="/settings/usage" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} aria-hidden /> Usage</Link>
      <PageHeader title="Allowances">
        How much of the workspace’s monthly budget each person can use. Owners and admins have no limit. Allowances reset on {new Date(p.resets_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.
      </PageHeader>

      <div className="space-y-8">
        <section className="surface px-5 py-5" aria-labelledby="budget-h">
          <h2 id="budget-h" className="text-base font-semibold tracking-tight">Monthly budget</h2>
          <p className="mt-0.5 text-sm text-ink-2">What the shares below are of.</p>
          <Segmented id="budget-basis" label="Budget" className="mt-4" value={d.basis} onChange={(b) => set((x) => ({ ...x, basis: b }))}
            options={[{ value: 'balance', label: 'Credits at the start of the month' }, { value: 'fixed', label: 'A fixed amount' }]} />
          <AnimatePresence mode="wait" initial={false}>
            {d.basis === 'fixed' ? (
              <motion.label key="fixed" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{currencySymbol()}</span>
                <Input inputMode="decimal" value={d.fixed} onChange={(e) => set((x) => ({ ...x, fixed: e.target.value.replace(/[^\d.]/g, '') }))} placeholder="500" className="h-9 w-36 tabular-nums" aria-invalid={fixedBad} aria-label="Fixed monthly budget" />
                <span className="text-sm text-muted-foreground">a month</span>
              </motion.label>
            ) : (
              <motion.p key="bal" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 text-sm text-ink-2">
                This month: <b className="font-semibold text-foreground tabular-nums">{money(p.budget.effective_usd)}</b>. It follows your credits, so top-ups raise everyone’s allowance.
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        <section className="surface px-5 py-5" aria-labelledby="roles-h">
          <h2 id="roles-h" className="text-base font-semibold tracking-tight">By role</h2>
          <p className="mt-0.5 text-sm text-ink-2">The default for everyone with that role. People with their own allowance keep it.</p>
          <div className="mt-5 space-y-6">
            {(['member', 'viewer'] as const).map((r) => (
              <div key={r}>
                <p className="mb-2 text-sm font-medium">{roleLabel(r)}s <span className="font-normal text-muted-foreground">· {r === 'viewer' ? 'alteria questions only' : 'runs and alteria'}</span></p>
                <ShareControl id={`role-${r}`} label={`${roleLabel(r)} share`} value={d.roles[r]} budget={budget} onChange={(v) => set((x) => ({ ...x, roles: { ...x.roles, [r]: v } }))} />
              </div>
            ))}
            <p className="flex items-center gap-2 text-sm text-muted-foreground">Owners and admins: no limit.</p>
          </div>
        </section>

        <section aria-labelledby="people-h">
          <h2 id="people-h" className="mb-1 text-base font-semibold tracking-tight">By person</h2>
          <p className="mb-3 text-sm text-ink-2">Give someone more or less than their role.</p>
          <ul className="surface divide-y">
            {people.map((x) => {
              const own = d.overrides[x.member.id]
              const custom = own != null
              const share = shareFor(x.member.id, x.member.role) ?? 0
              const cap = share * budget
              const used = cap ? Math.min(1, x.used_usd / cap) : 1
              return (
                <li key={x.member.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar p={x.member} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{x.member.name}</span>
                      <span className="block text-xs text-muted-foreground">{roleLabel(x.member.role)} · {custom ? `own allowance, ${pct(share)}` : `role default, ${pct(share)}`}</span>
                    </span>
                    <span className="w-40 text-xs tabular-nums">
                      <span className="flex justify-between"><span>{money(x.used_usd)}</span><span className="text-muted-foreground">of {money(cap)}</span></span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <motion.span className={cn('block h-full origin-left rounded-full', used >= 1 ? 'bg-stop' : used >= 0.8 ? 'bg-warn' : 'bg-primary')} initial={false} animate={{ scaleX: used }} transition={{ duration: 0.4, ease }} />
                      </span>
                    </span>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={custom} onCheckedChange={(on) => set((y) => ({ ...y, overrides: { ...y.overrides, [x.member.id]: on ? share : null } }))} aria-label={`Own allowance for ${x.member.name}`} />
                      Own
                    </label>
                  </div>
                  <AnimatePresence initial={false}>
                    {custom && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
                        <div className="pt-4 pl-[42px]">
                          <ShareControl id={`p-${x.member.id}`} label={`${x.member.name} share`} value={own!} budget={budget} onChange={(v) => set((y) => ({ ...y, overrides: { ...y.overrides, [x.member.id]: v } }))} />
                          <button type="button" onClick={() => set((y) => ({ ...y, overrides: { ...y.overrides, [x.member.id]: null } }))} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                            <ArrowCounterClockwise size={12} aria-hidden /> Back to the role default
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <AnimatePresence>
        {changes.length > 0 && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }}
            className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border bg-popover px-4 py-3 shadow-float">
            <span className="text-sm"><b className="font-semibold">{changes.length}</b> {changes.length === 1 ? 'change' : 'changes'} not saved</span>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(undefined)}>Discard</Button>
              <Button size="sm" onClick={() => setConfirming(true)} disabled={fixedBad}>Review and save</Button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Save these allowances?</AlertDialogTitle>
            <AlertDialogDescription>They apply from the next run or question.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
            {changes.map((c, i) => (
              <li key={i} className="px-4 py-2.5 text-sm">
                <span className="font-medium">{c.what}</span>
                {c.from !== c.to && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-ink-2 tabular-nums">{c.from} <ArrowRight size={12} aria-hidden /> <b className="font-semibold text-foreground">{c.to}</b></span>
                )}
                {c.warn && <span className="mt-1 flex items-start gap-1.5 text-xs text-warn"><Warning size={13} weight="fill" className="mt-px shrink-0" aria-hidden />{c.warn}</span>}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel>
            <Button onClick={save} disabled={saving}>{saving ? <><Loader /> Saving…</> : 'Save allowances'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
