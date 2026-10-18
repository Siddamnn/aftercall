// The pieces API docs pages are written with, on top of ../kit: code samples in several languages
// (the reader's pick is remembered across the site, Stripe style), endpoints, parameter lists,
// response fields, and cards. Prose pieces (H2, P, Note, Table…) come from ../kit.
import { ArrowRight, Check, Copy } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/utils'

// ── The chosen language, shared by every sample on the site ───────────────────

export type Lang = 'curl' | 'python' | 'node' | 'go' | 'php' | 'http' | 'json' | 'text' | 'bash'
const LABEL: Record<Lang, string> = { curl: 'cURL', python: 'Python', node: 'Node.js', go: 'Go', php: 'PHP', http: 'HTTP', json: 'JSON', text: 'Text', bash: 'Shell' }
const KEY = 'aftercall.api-docs.lang'
let chosen: Lang = (() => {
  try {
    return (localStorage.getItem(KEY) as Lang | null) ?? 'curl'
  } catch {
    return 'curl'
  }
})()
const subs = new Set<() => void>()
const setChosen = (l: Lang) => {
  chosen = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // Private mode: the pick lasts for this visit.
  }
  subs.forEach((f) => f())
}
const useChosen = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => chosen, () => chosen)

// ── Highlighting: enough to read samples, without a highlighter library ──────

const WORDS = new Set(['const', 'let', 'var', 'await', 'async', 'import', 'from', 'export', 'function', 'return', 'if', 'else', 'def', 'for', 'in', 'not', 'and', 'or', 'new', 'package', 'func', 'nil', 'true', 'false', 'null', 'True', 'False', 'None', 'try', 'catch', 'throw', 'raise', 'with', 'as', 'class', 'echo', 'use', 'require'])
const TOKENS = /((?<=^|\s)(?:\/\/|#)[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]+)\b/gm

function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === 'text') return [code]
  const out: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(TOKENS)) {
    const [all, comment, str, num, word] = m
    const at = m.index
    if (word && !WORDS.has(word)) continue
    if (at > last) out.push(code.slice(last, at))
    const cls = comment ? 'text-[var(--code-dim)] italic'
      : str ? (/^\s*:/.test(code.slice(at + all.length)) ? 'text-[var(--code-key)]' : 'text-[var(--code-str)]')
      : num ? 'text-[var(--code-num)]'
      : 'text-[var(--code-kw)]'
    out.push(<span key={at} className={cls}>{all}</span>)
    last = at + all.length
  }
  out.push(code.slice(last))
  return out
}

// ── Code ──────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      type="button" aria-label={done ? 'Copied' : 'Copy code'}
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true) }}
      className="grid size-7 place-items-center rounded-md text-[var(--code-dim)] transition-[color,background-color,scale] duration-150 hover:bg-white/10 hover:text-[var(--code-fg)] active:scale-95"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(done)} initial={{ opacity: 0, scale: 0.6, filter: 'blur(2px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
          {done ? <Check size={15} weight="bold" className="text-[var(--code-str)]" /> : <Copy size={15} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** One sample, or the same request in several languages with tabs. The tab picked applies to every
 *  sample on the site; a sample without that language shows its first. */
export function Sample({ samples, title, className }: { samples: Partial<Record<Lang, string>>; title?: string; className?: string }) {
  const langs = Object.keys(samples) as Lang[]
  const pick = useChosen()
  const lang = langs.includes(pick) ? pick : langs[0]
  const code = samples[lang]!.replace(/^\n/, '').replace(/\s+$/, '')
  const uid = useId()
  return (
    <figure data-search-skip className={cn('not-prose my-5 overflow-hidden rounded-xl border border-black/10 bg-[var(--code-bg)] text-[var(--code-fg)] shadow-panel dark:border-white/10', className)}>
      <figcaption className="flex items-center gap-2 border-b border-white/5 bg-[var(--code-bar)] py-1 pr-1.5 pl-3">
        {title && <span className="mr-1 truncate font-mono text-xs text-[var(--code-dim)]">{title}</span>}
        {langs.length > 1 ? (
          <div role="tablist" aria-label="Language" className="flex min-w-0 gap-0.5 overflow-x-auto">
            {langs.map((l) => (
              <button
                key={l} type="button" role="tab" aria-selected={l === lang} onClick={() => setChosen(l)}
                className={cn('relative isolate shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150', l === lang ? 'text-[var(--code-fg)]' : 'text-[var(--code-dim)] hover:text-[var(--code-fg)]')}
              >
                {l === lang && <motion.span layoutId={`lang-${uid}`} className="absolute inset-0 -z-10 rounded-md bg-white/10" transition={{ type: 'spring', visualDuration: 0.22, bounce: 0.1 }} />}
                {LABEL[l]}
              </button>
            ))}
          </div>
        ) : !title && <span className="text-xs font-medium text-[var(--code-dim)]">{LABEL[lang]}</span>}
        <span className="ml-auto"><CopyButton text={code} /></span>
      </figcaption>
      <AnimatePresence mode="wait" initial={false}>
        <motion.pre key={lang} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.15 }} className="max-h-[32rem] overflow-auto p-4 font-mono text-[0.8125rem] leading-6">
          <code>{highlight(code, lang)}</code>
        </motion.pre>
      </AnimatePresence>
    </figure>
  )
}

// ── Endpoints and fields ──────────────────────────────────────────────────────

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
const TONE: Record<Method, string> = {
  GET: 'bg-ok/10 text-ok',
  POST: 'bg-primary-soft text-primary',
  PATCH: 'bg-warn/10 text-warn',
  DELETE: 'bg-destructive/10 text-destructive',
}
export const MethodTag = ({ method, className }: { method: Method; className?: string }) => (
  <span className={cn('inline-flex h-5 shrink-0 items-center rounded-[6px] px-1.5 font-mono text-[0.6875rem] font-semibold tracking-wide', TONE[method], className)}>{method}</span>
)

/** METHOD /path, as it appears under an endpoint's heading. */
export const Route = ({ method, path }: { method: Method; path: string }) => (
  <p className="my-4 flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-2 font-mono text-sm shadow-panel">
    <MethodTag method={method} />
    <span className="truncate">{path.split(/(\{[^}]+\})/).map((p, i) => p.startsWith('{') ? <span key={i} className="text-primary">{p}</span> : p)}</span>
  </p>
)

export interface Field { name: string; type: string; required?: boolean; children?: Field[]; desc: ReactNode }

/** Parameters or response fields, Stripe style: name, type, required, then what it means. Nested
 *  objects open to their fields. */
export function Fields({ title, items }: { title?: string; items: Field[] }) {
  return (
    <div className="my-5">
      {title && <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>}
      <dl className="divide-y border-y">
        {items.map((f) => <FieldRow key={f.name} f={f} />)}
      </dl>
    </div>
  )
}
function FieldRow({ f }: { f: Field }) {
  return (
    <div className="py-3">
      <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <code className="font-mono text-sm font-semibold text-foreground">{f.name}</code>
        <span className="font-mono text-xs text-muted-foreground">{f.type}</span>
        {f.required && <span className="text-xs font-medium text-warn">required</span>}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-ink-2">
        {f.desc}
        {f.children && (
          <details className="group mt-2 rounded-lg border [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground select-none hover:text-foreground">
              <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span> child fields
            </summary>
            <dl className="divide-y border-t px-3">{f.children.map((c) => <FieldRow key={c.name} f={c} />)}</dl>
          </details>
        )}
      </dd>
    </div>
  )
}

// ── Cards and badges ──────────────────────────────────────────────────────────

export function Cards({ items, cols = 2 }: { items: { to: string; title: string; body: ReactNode; tag?: ReactNode; icon?: ReactNode }[]; cols?: 2 | 3 }) {
  return (
    <ul className={cn('not-prose my-6 grid gap-3', cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}>
      {items.map((c) => (
        <li key={c.title}>
          <Link to={c.to} className="group flex h-full flex-col rounded-xl border bg-card p-4 shadow-panel transition-[border-color,box-shadow] duration-200 hover:border-primary/35 hover:shadow-float">
            <span className="flex items-center gap-2.5">
              {c.icon}
              <span className="font-medium">{c.title}</span>
              {c.tag && <span className="ml-auto">{c.tag}</span>}
            </span>
            <span className="mt-1.5 text-sm leading-6 text-ink-2">{c.body}</span>
            <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-medium text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">Read <ArrowRight size={11} aria-hidden /></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export type Stage = 'tier 1' | 'tier 2' | 'tier 3' | 'planned'
export const StageTag = ({ stage }: { stage: Stage }) => (
  <span className={cn('rounded-[6px] px-1.5 py-0.5 text-[0.6875rem] font-medium', stage === 'tier 1' ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground')}>
    {stage === 'tier 1' ? 'First' : stage === 'tier 2' ? 'Next' : stage === 'tier 3' ? 'Later' : 'Planned'}
  </span>
)
