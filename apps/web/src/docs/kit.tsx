// The pieces docs articles are written with, so every article looks the same: headings that feed
// "On this page", short paragraphs, steps, tables, notes, terms and questions.
import { CaretDown, Info, Lightbulb, Warning } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/utils'

const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** A section heading. Listed in "On this page" and linkable (#its-id). */
export function H2({ children, anchor }: { children: string; anchor?: string }) {
  const a = anchor ?? id(children)
  return (
    <h2 id={a} data-toc={children} className="group mt-12 mb-3 scroll-mt-24 text-xl font-semibold tracking-tight first:mt-0">
      <a href={`#${a}`} className="no-underline">{children}<span className="ml-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>#</span></a>
    </h2>
  )
}
export const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-8 mb-2 text-base font-semibold">{children}</h3>
export const P = ({ children }: { children: ReactNode }) => <p className="my-3 leading-7 text-ink-2">{children}</p>
export const Lead = ({ children }: { children: ReactNode }) => <p className="mb-8 text-lg leading-8 text-ink-2 text-pretty">{children}</p>
export const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-foreground">{children}</b>
export const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
export const A = ({ to, children }: { to: string; children: ReactNode }) =>
  to.startsWith('http') || to.startsWith('mailto:')
    ? <a href={to} className="font-medium text-primary hover:underline" target={to.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>
    : <Link to={to} className="font-medium text-primary hover:underline">{children}</Link>

export function List({ items, ordered }: { items: ReactNode[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={cn('my-3 space-y-1.5 pl-5 leading-7 text-ink-2', ordered ? 'list-decimal' : 'list-disc marker:text-muted-foreground')}>
      {items.map((x, i) => <li key={i} className="pl-1">{x}</li>)}
    </Tag>
  )
}

/** Numbered steps, for "how to" articles. */
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="my-6 space-y-5">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary tabular-nums">{i + 1}</span>
          <div className="min-w-0 pt-0.5">
            <p className="font-medium">{s.title}</p>
            <div className="mt-1 leading-7 text-ink-2">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Note({ kind = 'info', children }: { kind?: 'info' | 'tip' | 'warn'; children: ReactNode }) {
  const [Icon, tone] = kind === 'tip' ? [Lightbulb, 'border-ok/25 bg-ok/5 [&>svg]:text-ok'] : kind === 'warn' ? [Warning, 'border-warn/30 bg-warn/5 [&>svg]:text-warn'] : [Info, 'border-primary/20 bg-primary-soft [&>svg]:text-primary']
  return (
    <div className={cn('my-5 flex gap-3 rounded-xl border px-4 py-3 text-sm leading-6 text-ink-2', tone)}>
      <Icon size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[32rem] text-sm">
        <thead><tr className="border-b bg-muted/40 text-left">{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b align-top last:border-0">{r.map((c, j) => <td key={j} className={cn('px-4 py-2.5', j ? 'text-ink-2' : 'font-medium')}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** A glossary: terms and what they mean, each linkable. */
export function Terms({ items }: { items: { term: string; means: ReactNode; see?: { to: string; label: string } }[] }) {
  return (
    <dl className="my-6 divide-y rounded-xl border">
      {items.map((t) => (
        <div key={t.term} id={id(t.term)} className="scroll-mt-24 px-4 py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
          <dt className="font-medium">{t.term}</dt>
          <dd className="mt-1 leading-7 text-ink-2 sm:mt-0">{t.means}{t.see && <> <A to={t.see.to}>{t.see.label}</A></>}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Questions that open to their answer. */
export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="my-4 divide-y rounded-xl border">
      {items.map((f) => (
        <details key={f.q} id={id(f.q)} className="group scroll-mt-24 px-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer items-center justify-between gap-3 py-3.5 font-medium">
            {f.q}
            <CaretDown size={14} className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <div className="pb-4 leading-7 text-ink-2">{f.a}</div>
        </details>
      ))}
    </div>
  )
}
