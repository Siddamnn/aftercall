// Docs → Import trackers (/docs/import-trackers; /guide redirects there): how to make a trackers
// file, for people who don't write JSON. Public, so signed out it skips what needs the app (alteria,
// your existing trackers). Conversations need no guide: the backend reads any layout (B51).
// The quickest way first (ask an AI with our prompt), then the template, then the reference.
import { ArrowRight, CaretRight, Check, Copy, DownloadSimple, Sparkle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listTrackers } from '../api'
import { AlteriaCta, AlteriaTrackersDialog } from '../alteria'
import { Button } from '../components/ui/button'
import { useLoad } from '../lib/hooks'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { pretty, TRACKERS_MINIMAL, TRACKERS_PROMPT, TRACKERS_TEMPLATE } from '../json-templates'
import { saveBlob } from '../lib/export'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Mono } from '../ui'
import { useCan } from '../access'
import { useMe } from '../people'

// ── Trackers ───────────────────────────────────────────────────────────────────

export function TrackersGuide() {
  const [alteria, setAlteria] = useState(false)
  const navigate = useNavigate()
  // Signed in and allowed to edit trackers: offer alteria, and know the names already taken.
  const canEdit = useCan('trackers.edit')
  const me = useMe().data
  const inApp = canEdit && !!me
  const existing = useLoad(() => (inApp ? listTrackers() : Promise.resolve([])), [alteria, inApp])
  return (
    <div className="space-y-10">
      <div className="flex justify-end"><CopyPage /></div>
      {inApp && <AlteriaTrackersDialog open={alteria} onOpenChange={setAlteria} existing={existing.data?.map((t) => t.name) ?? []} onImported={() => navigate('/trackers')} />}
      <Intro>
        A <b>tracker</b> is a group of related <b>signals</b>. A signal is one question aftercall asks every conversation, such as "Did they book?" or "How frustrated were they?". A file lets you set up many at once, or share them between projects.
      </Intro>

      {inApp && <AlteriaCta title="Let alteria do it" action="Draft with alteria" onClick={() => setAlteria(true)}>
        Describe your use case in a sentence or two. alteria drafts the trackers and signals, you tick the ones to keep, and they're added to this project.
      </AlteriaCta>}

      <Way n={1} title="Ask any AI assistant to design them">
        <Steps items={[
          <>Copy the prompt below.</>,
          <>Paste it into ChatGPT, Claude or Gemini, and describe your use case where it says <Mono>[DESCRIBE YOUR USE CASE…]</Mono>: what the conversations are, and what you want to find out.</>,
          <>Paste the JSON it gives back on <Link to="/trackers" className="font-medium text-primary hover:underline">Trackers</Link> → Import → <b>Paste JSON</b>. You'll see what it adds before anything is saved.</>,
        ]} />
        <Code label="Prompt" text={TRACKERS_PROMPT} file="aftercall-trackers-prompt.txt" wrap />
        <p className="text-sm text-muted-foreground">Ask the AI for changes in plain words ("add a signal for whether they mentioned a competitor"), then paste again. Existing trackers can be kept or replaced.</p>
      </Way>

      <Way n={2} title="Start from the template">
        <p className="text-sm text-ink-2">Two trackers with one signal of each type. Rename them and rewrite the questions for your calls.</p>
        <Code label="trackers.json" text={pretty(TRACKERS_TEMPLATE)} file="trackers.json" />
      </Way>

      <Way n={3} title="Write it yourself">
        <p className="text-sm text-ink-2">The smallest file that works:</p>
        <Code label="Smallest file" text={pretty(TRACKERS_MINIMAL)} file="trackers.json" />
        <Reference title="A tracker" rows={TRACKER_FIELDS} />
        <Reference title="A signal" rows={SIGNAL_FIELDS} />
        <Tips items={TRACKER_TIPS} />
      </Way>

      <Next to="/trackers" label="Import trackers" />
    </div>
  )
}

const TRACKER_FIELDS: [string, string, string][] = [
          ['name', 'Required', 'Lowercase letters, digits and _, starting with a letter; up to 64. Shown as words: call_outcome reads "Call outcome".'],
          ['description', 'Optional', 'One line on what it covers.'],
          ['signals', 'Required', 'A list of one or more signals.'],
]
const SIGNAL_FIELDS: [string, string, string][] = [
          ['name', 'Required', 'Same rule as tracker names. Unique within its tracker.'],
          ['type', 'Required', '"choice" (pick one option), "yes_no", or "score" (an ordered scale).'],
          ['instructions', 'Required', 'The question, in plain words. Say what to do when the conversation doesn’t show it.'],
          ['criteria', 'Depends', 'choice: an object of 2 or more options with a description each, and it must include "other". score: a list of 2 to 10 levels, lowest first, like "Calm: polite throughout". yes_no: leave it out.'],
          ['review_threshold', 'Optional', 'From 0 to 1. Answers less sure than this are flagged for a person to check.'],
]
const TRACKER_TIPS = [
  'One question per signal. "Did they book, and were they happy?" is two signals.',
  'Every choice needs an "other" option, so an odd conversation has somewhere to go.',
  'Fewer signals cost less and are answered better. Start with three or four that change a decision.',
]

// ── Copy page: the whole guide as Markdown, for an AI chat, a wiki or a teammate ─

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``
const table = (rows: [string, string, string][]) => ['| Field | | What it is |', '|---|---|---|', ...rows.map(([k, n, w]) => `| \`${k}\` | ${n} | ${w.replaceAll('|', '\\|')} |`)].join('\n')

export function guideMarkdown() {
  return [
    '# aftercall: importing trackers',
    'Trackers are the questions aftercall asks every conversation. Conversations need no preparing: upload transcripts in any layout (CSV, JSON, JSONL, plain text, VTT or SRT) on Analyse calls.',
    'Quickest: let **alteria**, the built-in AI, draft them. On Trackers choose “Draft with alteria”.',
    'A tracker groups related signals. A signal is one question asked of every conversation.',
    '### Ask any AI assistant',
    fence('text', TRACKERS_PROMPT),
    '### Template',
    fence('json', pretty(TRACKERS_TEMPLATE)),
    '### Smallest file that works',
    fence('json', pretty(TRACKERS_MINIMAL)),
    '### Tracker fields',
    table(TRACKER_FIELDS),
    '### Signal fields',
    table(SIGNAL_FIELDS),
    TRACKER_TIPS.map((t) => `- ${t}`).join('\n'),
  ].join('\n\n') + '\n'
}

function CopyPage() {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1800)
    return () => clearTimeout(t)
  }, [done])
  return (
    <span className="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => saveBlob(new Blob([guideMarkdown()], { type: 'text/markdown' }), 'aftercall-file-guide.md')}>
        <DownloadSimple aria-hidden /> .md
      </Button>
      <Button variant="outline" size="sm" className="w-32" title="The whole guide as Markdown, to paste into an AI chat or your docs"
        onClick={async () => { await navigator.clipboard.writeText(guideMarkdown()); setDone(true) }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={String(done)} className="flex items-center gap-1.5" initial={{ opacity: 0, scale: 0.8, filter: 'blur(2px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
            {done ? <><Check weight="bold" className="text-ok" aria-hidden /> Copied</> : <><Copy aria-hidden /> Copy page</>}
          </motion.span>
        </AnimatePresence>
      </Button>
    </span>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function Intro({ children }: { children: ReactNode }) {
  return <p className="max-w-[68ch] text-ink-2">{children}</p>
}

function Way({ n, title, badge, children }: { n: number; title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby={`way-${n}`}>
      {/* data-toc: the plain title for "On this page" and search, without the number or badge. */}
      <h2 id={`way-${n}`} data-toc={title} className="flex scroll-mt-24 items-center gap-2.5 text-lg font-semibold tracking-tight">
        <span className="grid size-6 place-items-center rounded-full bg-foreground text-xs text-background tabular-nums">{n}</span>
        {title}
        {badge && <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary"><Sparkle size={11} weight="fill" aria-hidden />{badge}</span>}
      </h2>
      {children}
    </section>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm leading-relaxed">
          <span className="grid size-5 place-items-center rounded-full border text-[0.6875rem] font-medium text-muted-foreground tabular-nums">{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  )
}

function Code({ label, text, file, wrap }: { label: string; text: string; file: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <figure className="overflow-hidden rounded-xl border bg-muted/40">
      <figcaption className="flex items-center justify-between gap-2 border-b bg-card px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => saveBlob(new Blob([text], { type: file.endsWith('.json') ? 'application/json' : 'text/plain' }), file)}>
            <DownloadSimple aria-hidden /> Download
          </Button>
          <Button variant="outline" size="sm" className="w-24" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true) }} aria-live="polite">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={String(copied)} className="flex items-center gap-1" initial={{ opacity: 0, scale: 0.8, filter: 'blur(2px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
                {copied ? <><Check weight="bold" className="text-ok" aria-hidden /> Copied</> : <><Copy aria-hidden /> Copy</>}
              </motion.span>
            </AnimatePresence>
          </Button>
        </span>
      </figcaption>
      <pre className={cn('max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed text-ink-2', wrap && 'whitespace-pre-wrap')}>{text}</pre>
    </figure>
  )
}

function Reference({ title, rows }: { title?: string; rows: [string, string, string][] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-medium hover:text-primary">
        <CaretRight size={12} weight="bold" className="transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden />
        {title ? `Every field of ${title.toLowerCase()}` : 'Every field'}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([k, need, what]) => (
                <tr key={k} className="border-t first:border-t-0">
                  <th scope="row" className="w-40 px-3 py-2.5 text-left align-top font-normal"><Mono className="font-medium">{k}</Mono></th>
                  <td className="w-28 px-3 py-2.5 align-top">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-medium', need === 'Required' ? 'bg-primary-soft text-primary' : need === 'Coming soon' ? 'bg-warn-soft text-warn' : 'bg-muted text-muted-foreground')}>{need}</span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Tips({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-ink-2">
      {items.map((t) => <li key={t} className="flex gap-2"><Check size={14} weight="bold" className="mt-0.5 shrink-0 text-ok" aria-hidden />{t}</li>)}
    </ul>
  )
}

function Next({ to, label }: { to: string; label: string }) {
  return (
    <div className="flex justify-end">
      <Button asChild size="lg"><Link to={to}>{label} <ArrowRight aria-hidden /></Link></Button>
    </div>
  )
}
