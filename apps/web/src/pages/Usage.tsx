import { CaretRight, Prohibit } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { getUsage, type UsageDay } from '../api'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import { compact, money, num } from '../lib/format'
import { ease } from '../lib/motion'
import { useLoad } from '../lib/hooks'
import { ErrorNote, Num, Segmented } from '../ui'
import { MembersUsagePanel } from './UsageMembers'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5))
const short = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const PRESETS = { '7': 6, '14': 13, '30': 29 } as const
type Preset = keyof typeof PRESETS | 'custom'

/** Settings → Usage (it was /usage). */
export default function Usage() {
  const [range, setRange] = useState({ start: daysAgo(13), end: daysAgo(0) })
  const { data, error, loading, reload } = useLoad(() => getUsage(range.start, range.end), [range.start, range.end])
  const t = data?.totals
  const preset = (Object.entries(PRESETS).find(([, d]) => range.start === daysAgo(d) && range.end === daysAgo(0))?.[0] ?? 'custom') as Preset

  return (
    <>
      <p className="mb-6 max-w-[62ch] text-ink-2">
        The workspace pays for the tokens its runs use, and nothing else, from its shared credits. These are the tokens the model reported, not estimates.
      </p>

      <div className="mb-8 flex flex-wrap items-end gap-3">
        <Segmented
          id="usage-range"
          label="Date range"
          value={preset}
          onChange={(p) => p !== 'custom' && setRange({ start: daysAgo(PRESETS[p]), end: daysAgo(0) })}
          options={[
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' },
          ]}
        />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <Input type="date" className="h-8 w-auto text-sm text-foreground" value={range.start} max={range.end} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <Input type="date" className="h-8 w-auto text-sm text-foreground" value={range.end} min={range.start} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
        </label>
      </div>

      <MembersUsagePanel start={range.start} end={range.end} />

      {error && <ErrorNote onRetry={reload} className="mb-6">Couldn't load usage. {error}</ErrorNote>}

      {!t ? (
        loading && (
          <div aria-busy="true">
            <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
            <div className="skeleton mt-6 h-80 rounded-xl" />
          </div>
        )
      ) : (
        <div className={cn('transition-opacity duration-200', loading && 'opacity-60')}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="surface px-5 py-4 sm:col-span-2 lg:col-span-1">
              <dt className="text-sm text-muted-foreground">Tokens billed</dt>
              <dd className="mt-1 text-[2.5rem] leading-none font-semibold tracking-[-0.04em]"><Num value={t.billed_input_tokens} /></dd>
            </div>
            <div className="surface px-5 py-4">
              <dt className="text-sm text-muted-foreground">Cost</dt>
              <dd className="mt-1.5 text-xl font-semibold">{t.cost === null ? <span className="text-muted-foreground">Not priced yet</span> : money(t.cost)}</dd>
            </div>
            <div className="surface px-5 py-4">
              <dt className="text-sm text-muted-foreground">Calls analysed</dt>
              <dd className="mt-1.5 text-xl font-semibold"><Num value={t.calls_analyzed} /></dd>
            </div>
            <div className="surface px-5 py-4">
              <dt className="text-sm text-muted-foreground">Requests</dt>
              <dd className="mt-1.5 text-xl font-semibold"><Num value={t.jev_requests} /></dd>
            </div>
          </dl>

          {data.pricing.price !== null && (
            <p className="mt-3 text-sm text-muted-foreground">At {money(data.pricing.price)} per 1M input tokens used.</p>
          )}

          <Chart days={data.days} />

          {t.over_limit_calls > 0 && (
            <p className="mt-6 flex max-w-[70ch] gap-2.5 text-ink-2">
              <Prohibit size={20} className="mt-0.5 shrink-0 text-stop" weight="bold" aria-hidden />
              <span>
                {t.over_limit_calls === 1 ? '1 call was' : `${num(t.over_limit_calls)} calls were`} over {num(data.token_budget)} tokens, so{' '}
                {t.over_limit_calls === 1 ? "it wasn't" : "they weren't"} run and cost nothing. Together they hold {num(t.over_limit_tokens)} tokens of transcript.
              </span>
            </p>
          )}

          <details className="group mt-8">
            <summary className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <CaretRight size={12} weight="bold" className="transition-transform duration-200 group-open:rotate-90" aria-hidden />
              Show as a table
            </summary>
            <div className="surface mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {['Day', 'Calls', 'Requests', 'Tokens billed', 'Over the limit', ...(t.cost !== null ? ['Cost'] : [])].map((h, i) => (
                      <th key={h} scope="col" className={cn('px-4 py-2.5 font-medium', i && 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.days.map((d) => (
                    <tr key={d.date} className="border-b last:border-0">
                      <th scope="row" className="px-4 py-2 text-left font-normal">{short(d.date)}</th>
                      <td className="px-4 py-2 text-right">{num(d.calls_analyzed)}</td>
                      <td className="px-4 py-2 text-right">{num(d.jev_requests)}</td>
                      <td className="px-4 py-2 text-right">{num(d.billed_input_tokens)}</td>
                      <td className="px-4 py-2 text-right">{d.over_limit_calls || ''}</td>
                      {d.cost !== null && <td className="px-4 py-2 text-right">{money(d.cost)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </>
  )
}

function niceMax(max: number) {
  const pow = 10 ** Math.floor(Math.log10(max || 1))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= max)!
  return { top: step * 4, ticks: [4, 3, 2, 1, 0].map((i) => i * step) }
}

function Chart({ days }: { days: UsageDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!days.length) return <p className="mt-6 rounded-xl border border-dashed px-6 py-10 text-center text-ink-2">No calls were analysed in these dates.</p>
  const { top, ticks } = niceMax(Math.max(...days.map((d) => d.billed_input_tokens)))
  const h = hover === null ? undefined : days[hover]
  const every = Math.ceil(days.length / 8)

  return (
    <figure className="surface mt-6 px-5 pt-5 pb-4">
      <figcaption className="mb-5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Tokens billed per day</span>
        {days.some((d) => d.over_limit_calls) && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Prohibit size={12} weight="bold" className="text-stop" aria-hidden /> Calls over the limit (not run, not charged)
          </span>
        )}
      </figcaption>
      <div className="grid grid-cols-[2.75rem_1fr] gap-2">
        <div className="relative h-60 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (v / top) * 100}%` }}>{compact(v)}</span>
          ))}
        </div>
        <div className="relative h-60" onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <div key={v} className={cn('absolute inset-x-0 border-t', v ? 'border-dashed border-border/80' : 'border-border')} style={{ top: `${100 - (v / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {days.map((d, i) => (
              <button
                key={d.date}
                className="relative flex h-full flex-1 items-end focus-visible:outline-offset-0"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${short(d.date)}: ${num(d.billed_input_tokens)} tokens, ${d.calls_analyzed} calls${d.over_limit_calls ? `, ${d.over_limit_calls} over the limit` : ''}`}
              >
                <motion.span
                  className={cn('w-full origin-bottom rounded-t-[4px] bg-primary transition-opacity duration-150', hover !== null && hover !== i && 'opacity-40')}
                  style={{ height: `${(d.billed_input_tokens / top) * 100}%` }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.5, ease, delay: Math.min(i, 20) * 0.02 }}
                />
              </button>
            ))}
          </div>
          <AnimatePresence>
            {h && (
              <motion.div
                key="tip"
                className="pointer-events-none absolute z-10 w-max rounded-lg border bg-popover px-3 py-2 text-sm shadow-float"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  left: `clamp(5rem, ${((hover! + 0.5) / days.length) * 100}%, calc(100% - 5rem))`,
                  bottom: `calc(${(h.billed_input_tokens / top) * 100}% + 10px)`,
                }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ type: 'spring', visualDuration: 0.2, bounce: 0 }}
                style={{ x: '-50%' }}
                role="status"
              >
                <div className="font-semibold">{short(h.date)}</div>
                <div className="text-ink-2 tabular-nums">{num(h.billed_input_tokens)} tokens</div>
                <div className="text-muted-foreground tabular-nums">{num(h.calls_analyzed)} calls, {num(h.jev_requests)} requests</div>
                {h.over_limit_calls > 0 && <div className="text-stop">{h.over_limit_calls} over the limit, not run</div>}
                {h.cost !== null && <div className="text-muted-foreground">{money(h.cost)}</div>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div />
        <div className="flex gap-[3px] text-xs text-muted-foreground" aria-hidden>
          {days.map((d, i) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1 overflow-visible">
              {d.over_limit_calls > 0 ? <Prohibit size={12} weight="bold" className="text-stop" /> : <span className="h-3" />}
              <span className="whitespace-nowrap">{i % every === 0 ? short(d.date) : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  )
}
