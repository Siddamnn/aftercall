// Paste JSON instead of choosing a file. It's checked when the box loses focus or on Check,
// never while typing: syntax errors point at the line, and the shape is checked before the
// backend's own dry run. A good paste becomes a File, so the rest of the flow doesn't change.
import { ArrowSquareOut, CheckCircle, ClipboardText, MagicWand } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from './components/ui/button'
import { Label } from './components/ui/label'
import { Textarea } from './components/ui/textarea'
import { CALLS_TEMPLATE, pretty, TRACKERS_TEMPLATE } from './json-templates'
import { plural } from './lib/format'
import { ease } from './lib/motion'
import { cn } from './lib/utils'

export type JsonKind = 'calls' | 'trackers'

type Check = { ok: true; count: number } | { ok: false; errors: string[] }

/** "Expected ',' or '}' … at position 57" → "Line 4, column 3: expected ',' or '}'", plus a hint for the usual slips. */
function syntaxError(text: string, e: Error): string[] {
  const pos = Number(/position (\d+)/.exec(e.message)?.[1])
  let where = ''
  if (Number.isFinite(pos)) {
    const before = text.slice(0, pos).split('\n')
    where = `Line ${before.length}, column ${before[before.length - 1].length + 1}: `
  }
  const what = e.message.replace(/\s*in JSON at position \d+.*$/, '').replace(/^JSON\.parse: /, '').replace(/^./, (c) => c.toLowerCase())
  const out = [`${where}${what}.`]
  if (/[“”]/.test(text)) out.push('It has curly quotes (“ ”). JSON needs straight double quotes ("), so replace them.')
  else if (/'[^']*'\s*:/.test(text)) out.push('Keys and text need double quotes ("), not single quotes.')
  if (/,\s*[}\]]/.test(text)) out.push('There is a comma right before a } or ]. JSON doesn’t allow a trailing comma: remove it.')
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function checkJson(kind: JsonKind, text: string): Check {
  if (!text.trim()) return { ok: false, errors: ['The box is empty. Paste your JSON, or insert the example to see the shape.'] }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: syntaxError(text, e as Error) }
  }
  const errors: string[] = []
  const more = (list: string[]) => (list.length > 6 ? [...list.slice(0, 6), `…and ${list.length - 6} more.`] : list)

  if (kind === 'calls') {
    const rows = Array.isArray(doc) ? doc : isObj(doc) ? doc.calls : undefined
    if (!Array.isArray(rows)) {
      if (Array.isArray(doc) || (isObj(doc) && 'trackers' in doc)) return { ok: false, errors: ['This looks like trackers, not conversations. Import it on the Trackers page.'] }
      return { ok: false, errors: ['Expected a list of conversations, or {"calls": [...]}.'] }
    }
    if (!rows.length) return { ok: false, errors: ['The list is empty: add at least one conversation.'] }
    if (rows.every((r) => isObj(r) && 'signals' in r)) return { ok: false, errors: ['This looks like trackers, not conversations. Import it on the Trackers page.'] }
    rows.forEach((r, i) => {
      const at = `Conversation ${i + 1}`
      if (!isObj(r)) return void errors.push(`${at} isn't an object ({ … }).`)
      const t = r.transcript
      if (t === undefined) errors.push(`${at} has no "transcript".`)
      else if (typeof t === 'string') { if (!t.trim()) errors.push(`${at}: the transcript is empty.`) }
      else if (Array.isArray(t)) {
        if (!t.length) errors.push(`${at}: the transcript has no turns.`)
        t.forEach((turn, j) => {
          if (typeof turn !== 'string' && !(isObj(turn) && ['text', 'content', 'message'].some((k) => typeof turn[k] === 'string'))) {
            errors.push(`${at}, turn ${j + 1}: needs "text" (and a "speaker").`)
          }
        })
      } else errors.push(`${at}: "transcript" must be text or a list of turns.`)
    })
    return errors.length ? { ok: false, errors: more(errors) } : { ok: true, count: rows.length }
  }

  const items = Array.isArray(doc) ? doc : isObj(doc) ? doc.trackers : undefined
  if (!Array.isArray(items)) {
    if (isObj(doc) && 'calls' in doc) return { ok: false, errors: ['This looks like conversations, not trackers. Analyse it on the Analyse calls page.'] }
    return { ok: false, errors: ['Expected a list of trackers, or {"trackers": [...]}.'] }
  }
  if (!items.length) return { ok: false, errors: ['The list is empty: add at least one tracker.'] }
  if (items.every((r) => isObj(r) && 'transcript' in r)) return { ok: false, errors: ['This looks like conversations, not trackers. Analyse it on the Analyse calls page.'] }
  const NAME = /^[a-z][a-z0-9_]{0,63}$/
  items.forEach((t, i) => {
    const at = `Tracker ${i + 1}${isObj(t) && typeof t.name === 'string' ? ` (${t.name})` : ''}`
    if (!isObj(t)) return void errors.push(`${at} isn't an object ({ … }).`)
    if (typeof t.name !== 'string' || !NAME.test(t.name) || t.name.includes('__')) errors.push(`${at}: "name" must be lowercase letters, digits and _, starting with a letter.`)
    if (!Array.isArray(t.signals) || !t.signals.length) return void errors.push(`${at}: needs "signals", a list of at least one.`)
    t.signals.forEach((s, j) => {
      const sat = `${at}, signal ${j + 1}${isObj(s) && typeof s.name === 'string' ? ` (${s.name})` : ''}`
      if (!isObj(s)) return void errors.push(`${sat} isn't an object.`)
      if (typeof s.name !== 'string' || !NAME.test(s.name)) errors.push(`${sat}: "name" must be lowercase letters, digits and _, starting with a letter.`)
      if (!['choice', 'yes_no', 'score'].includes(String(s.type))) errors.push(`${sat}: "type" must be "choice", "yes_no" or "score".`)
      if (typeof s.instructions !== 'string' || !s.instructions.trim()) errors.push(`${sat}: add "instructions", the question to ask.`)
      if (s.type === 'choice' && !(isObj(s.criteria) && Object.keys(s.criteria).length >= 2 && 'other' in s.criteria)) errors.push(`${sat}: a choice needs "criteria" with 2 or more options, including "other".`)
      if (s.type === 'score' && !(Array.isArray(s.criteria) && s.criteria.length >= 2 && s.criteria.length <= 10)) errors.push(`${sat}: a score needs "criteria", a list of 2 to 10 levels, lowest first.`)
    })
  })
  return errors.length ? { ok: false, errors: more(errors) } : { ok: true, count: items.length }
}

export function PasteJson({ kind, onUse, busy, action }: {
  kind: JsonKind
  /** Called with the pasted text as a .json file once it passes the checks. */
  onUse: (file: File) => void
  busy?: boolean
  action?: string
}) {
  const [text, setText] = useState('')
  const [check, setCheck] = useState<Check>()
  const noun = kind === 'calls' ? 'conversation' : 'tracker'
  const run = (t = text) => {
    const c = checkJson(kind, t)
    setCheck(c)
    return c
  }
  const use = () => {
    const c = run()
    if (c.ok) onUse(new File([text], `pasted-${kind}.json`, { type: 'application/json' }))
  }
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      setText(t)
      run(t)
    } catch {
      setCheck({ ok: false, errors: ['The browser didn’t allow reading the clipboard. Click in the box and press ⌘V (Ctrl+V) instead.'] })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Label htmlFor={`paste-${kind}`}>Paste JSON</Label>
        <Link to={kind === 'trackers' ? '/docs/import-trackers' : '/docs/analysing-conversations'} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          How to write it, or make it with AI <ArrowSquareOut size={12} aria-hidden />
        </Link>
      </div>
      <p id={`paste-${kind}-help`} className="text-xs text-muted-foreground">
        {kind === 'calls' ? 'A list of conversations, or {"calls": [...]}. Each needs a transcript.' : 'A list of trackers, or {"trackers": [...]}, like the sample set.'}
      </p>
      <Textarea
        id={`paste-${kind}`} value={text} spellCheck={false} rows={10} aria-describedby={`paste-${kind}-help paste-${kind}-status`}
        aria-invalid={check && !check.ok}
        placeholder={kind === 'calls' ? '{\n  "calls": [\n    { "transcript": "agent: Hello!\\ncaller: Hi…" }\n  ]\n}' : '[\n  { "name": "outcome", "signals": [ … ] }\n]'}
        onChange={(e) => { setText(e.target.value); if (check) setCheck(undefined) }}
        onBlur={() => text.trim() && run()}
        onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t && !text) setTimeout(() => run(t), 0) }}
        className="max-h-[50dvh] min-h-40 resize-y font-mono text-xs leading-relaxed md:text-xs"
      />
      <div id={`paste-${kind}-status`} aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {check && (
            <motion.div key={check.ok ? 'ok' : check.errors.join()} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
              {check.ok ? (
                <p className="flex items-center gap-1.5 text-sm text-ok"><CheckCircle weight="fill" aria-hidden /> Looks right: {plural(check.count, noun)}.</p>
              ) : (
                <ul className="space-y-1 rounded-lg border border-stop/25 bg-stop-soft px-3 py-2 text-sm text-ink-2" role="alert">
                  {check.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={use} disabled={busy || !text.trim()}>{action ?? `Check ${kind}`}</Button>
        <Button variant="ghost" size="sm" onClick={fromClipboard}><ClipboardText aria-hidden /> Paste from clipboard</Button>
        <Button variant="ghost" size="sm" className={cn(text && 'hidden')} onClick={() => { const t = pretty(kind === 'calls' ? CALLS_TEMPLATE : TRACKERS_TEMPLATE); setText(t); setCheck(undefined) }}>
          <MagicWand aria-hidden /> Insert an example
        </Button>
      </div>
    </div>
  )
}
