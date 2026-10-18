// Usage by person (B54), on Settings → Usage. Credits are the workspace's; each person's runs and
// alteria questions are counted against them too. Owners and admins see everyone and can give a
// member a monthly allowance (on Settings → Usage → Allowances, pages/Allowances.tsx); members see their own line and allowance next to the workspace total.
import { SlidersHorizontal } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { getMembersUsage, getMyUsage, type Allowance } from '../api'
import { useCan } from '../access'
import { Button } from '../components/ui/button'
import { compact, money, num } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Avatar, roleLabel } from '../people'
import { ErrorNote } from '../ui'

const resets = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function AllowanceBar({ a, className }: { a: Allowance; className?: string }) {
  if (a.monthly_usd === null) return <span className={cn('text-xs text-muted-foreground', className)}>No limit</span>
  const share = Math.min(1, a.used_usd / a.monthly_usd)
  return (
    <span className={cn('block', className)}>
      <span className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span><b className="font-medium">{money(a.used_usd)}</b> <span className="text-muted-foreground">of {money(a.monthly_usd)}</span></span>
        <span className={share >= 1 ? 'text-stop' : share >= 0.8 ? 'text-warn' : 'text-muted-foreground'}>{Math.round(share * 100)}%</span>
      </span>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <motion.span className={cn('block h-full origin-left rounded-full', share >= 1 ? 'bg-stop' : share >= 0.8 ? 'bg-warn' : 'bg-primary')} initial={{ scaleX: 0 }} animate={{ scaleX: share }} transition={{ duration: 0.5, ease }} />
      </span>
    </span>
  )
}

export function MembersUsagePanel({ start, end }: { start: string; end: string }) {
  const everyone = useCan('usage.members')
  const self = useCan('usage.self')
  const data = useLoad(() => (everyone ? getMembersUsage(start, end) : getMyUsage(start, end)), [start, end, everyone])
  if (!self) return null
  if (data.error && !data.data) return <ErrorNote onRetry={data.reload} className="mb-8">Couldn’t load usage by person. {data.error}</ErrorNote>
  if (!data.data) return <div className="skeleton mb-8 h-40 rounded-xl" />
  const rows = data.data.members
  const ws = data.data.workspace

  if (!everyone) {
    const mine = rows[0]
    if (!mine) return null
    const share = ws.tokens ? mine.tokens / ws.tokens : 0
    return (
      <section className="mb-8 grid gap-3 lg:grid-cols-2" aria-label="Your usage">
        <div className="surface px-5 py-4">
          <h2 className="text-sm text-muted-foreground">Your usage</h2>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{compact(mine.tokens)} <span className="text-sm font-normal text-muted-foreground">tokens</span>{mine.spend !== null && <span className="ml-2 text-base font-normal text-muted-foreground">{money(mine.spend)}</span>}</p>
          <p className="text-xs text-muted-foreground">{num(mine.conversations)} conversations · {num(mine.alteria_questions)} alteria questions · {Math.round(share * 100)}% of the workspace</p>
          <div className="mt-4">
            <p className="mb-1.5 text-sm font-medium">Your monthly allowance</p>
            <AllowanceBar a={mine.allowance} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {mine.allowance.monthly_usd === null ? 'Set by the owner or an admin. You have none, so you can use the workspace’s credits freely.' : `Resets ${resets(mine.allowance.resets_at)}. Past it, runs and questions wait until an admin raises it.`}
            </p>
          </div>
        </div>
        <div className="surface px-5 py-4">
          <h2 className="text-sm text-muted-foreground">The whole workspace</h2>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{compact(ws.tokens)} <span className="text-sm font-normal text-muted-foreground">tokens</span>{ws.spend !== null && <span className="ml-2 text-base font-normal text-muted-foreground">{money(ws.spend)}</span>}</p>
          <p className="text-xs text-muted-foreground">{num(ws.conversations)} conversations, everyone together. The chart below is the workspace’s.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8" aria-labelledby="by-person-h">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="by-person-h" className="text-sm font-medium text-muted-foreground">By person</h2>
        <Button size="sm" variant="outline" asChild><Link to="/settings/usage/allowances"><SlidersHorizontal aria-hidden /> Manage allowances</Link></Button>
      </div>
      <div className="surface overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {['Person', 'Tokens', 'Cost', 'Conversations', 'alteria', 'Monthly allowance'].map((h, i) => (
                <th key={h} scope="col" className={cn('px-4 py-2.5 font-medium', i > 0 && i < 5 && 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((m) => (
              <tr key={m.member.id} className="border-b last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  <span className="flex items-center gap-2.5">
                    <Avatar p={m.member} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.member.name}</span>
                      <span className="block text-xs text-muted-foreground">{roleLabel(m.member.role)}</span>
                    </span>
                  </span>
                </th>
                <td className="px-4 py-2.5 text-right">{compact(m.tokens)}</td>
                <td className="px-4 py-2.5 text-right">{m.spend === null ? '·' : money(m.spend)}</td>
                <td className="px-4 py-2.5 text-right">{num(m.conversations)}</td>
                <td className="px-4 py-2.5 text-right">{num(m.alteria_questions)}</td>
                <td className="w-64 px-4 py-2.5">
                  {m.member.role === 'owner' || m.member.role === 'admin' ? (
                    <span className="text-xs text-muted-foreground">No limit ({roleLabel(m.member.role).toLowerCase()})</span>
                  ) : (
                    <AllowanceBar a={m.allowance} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
