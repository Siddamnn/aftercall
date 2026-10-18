// alteria's built-in AI (B38). It does the fiddly parts for people who'd rather not
// write JSON: turns raw transcripts into conversations to upload, drafts trackers from a goal,
// and drafts a single signal from a question. Every draft is shown before anything is saved.
import { ArrowLeft, Check, DownloadSimple, FileArrowUp, ShieldCheck, Warning } from '@phosphor-icons/react'
import { AlteriaLoader, Loader } from './loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from './lib/toast'
import {
  alteriaConversations, alteriaSignal, alteriaTrackers, importTrackers, USING_MOCK,
  type AlteriaConversations, type AlteriaTrackers, type ApiError, type SignalSpec, type TrackerDraft,
} from './api'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Textarea } from './components/ui/textarea'
import { saveBlob } from './lib/export'
import { plural, title } from './lib/format'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { AlteriaMark } from './alteria-mark'
import { Mono, Segmented, TypeTag } from './ui'

export { AlteriaMark }

/** The alteria name, always with its mark and always lowercase. */
export function AlteriaName({ className, active }: { className?: string; active?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-semibold text-primary', className)}>
      <AlteriaMark size={15} active={active} />alteria
    </span>
  )
}

/** The call to action wherever alteria can take over a job. */
export function AlteriaCta({ title: heading, children, action, onClick, className }: { title: string; children: ReactNode; action: string; onClick: () => void; className?: string }) {
  return (
    <div className={cn('relative isolate flex flex-wrap items-center gap-4 overflow-hidden rounded-xl border border-primary/25 bg-primary-soft/50 p-4 sm:p-5', className)}>
      <div className="dot-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-panel"><AlteriaMark size={22} /></span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-semibold tracking-tight">{heading}</p>
        <p className="text-sm text-ink-2">{children}</p>
      </div>
      <Button onClick={onClick} className="shrink-0"><AlteriaMark /> {action}</Button>
    </div>
  )
}

/** "Working" copy that moves through what alteria is doing, so a wait doesn't feel stuck. */
function Thinking({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, lines.length - 1)), 900)
    return () => clearInterval(t)
  }, [lines.length])
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-8 text-center" role="status" aria-live="polite">
      <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><AlteriaMark size={26} active /></span>
      <AnimatePresence mode="wait">
        <motion.p key={i} className="shimmer-text text-sm font-medium" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}>
          {lines[i]}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

function Problem({ children }: { children: ReactNode }) {
  return <p role="alert" className="flex items-start gap-2 rounded-lg border border-stop/25 bg-stop-soft px-3 py-2 text-sm text-ink-2"><Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-stop" aria-hidden />{children}</p>
}

const needsB38 = (e: ApiError) => (USING_MOCK || (e.status !== 404 && e.status !== 405) ? e.message : 'alteria needs the backend’s /alteria endpoints (request B38). Until then, use the prompt on this page with any AI assistant.')

/** Re-mount the body on every opening, so each run starts clean. */
function useOpens(open: boolean) {
  const [opens, setOpens] = useState(0)
  const [was, setWas] = useState(open)
  if (open !== was) {
    setWas(open)
    if (open) setOpens((n) => n + 1)
  }
  return opens
}

// ── Conversations ──────────────────────────────────────────────────────────────

const MESSY = `Call 1042
Priya (agent): Hello, Sunrise Clinic, how can I help?
Customer: hi i want to book a cleaning for saturday
Priya (agent): Saturday 11am works. Shall I book it?
Customer: yes pls

---

Chat 1043
[10:02] Bot: Hi! What can I do for you?
[10:03] User: how much is a consultation
[10:03] Bot: The first one is 500 rupees.
[10:04] User: too much, thanks`

export function AlteriaConversationsDialog({ open, onOpenChange, onUse }: { open: boolean; onOpenChange: (o: boolean) => void; onUse: (file: File) => void }) {
  const opens = useOpens(open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <ConversationsBody key={opens} onUse={(f) => { onUse(f); onOpenChange(false) }} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ConversationsBody({ onUse, onClose }: { onUse: (f: File) => void; onClose: () => void }) {
  const [how, setHow] = useState<'text' | 'file'>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<AlteriaConversations>()

  const convert = async () => {
    if (how === 'text' ? !text.trim() : !file) return setError(how === 'text' ? 'Paste some transcripts first, or try the example.' : 'Choose a file first.')
    setBusy(true)
    setError(undefined)
    try {
      setResult(await alteriaConversations(how === 'text' ? { text } : { file }))
    } catch (e) {
      setError(needsB38(e as ApiError))
    } finally {
      setBusy(false)
    }
  }
  const json = () => JSON.stringify({ calls: result!.calls }, null, 2)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <AlteriaMark size={20} className="text-primary" /> Let alteria prepare your conversations
        </DialogTitle>
        <DialogDescription className="text-ink-2">
          Paste transcripts in any format: copied from your call platform, a chat export or a document. alteria turns them into the file it needs. Nothing is analysed or saved yet.
        </DialogDescription>
      </DialogHeader>

      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Thinking lines={['Reading your transcripts…', 'Finding where each conversation starts…', 'Working out who is speaking…', 'Writing the file…']} />
          </motion.div>
        ) : result ? (
          <motion.div key="result" className="space-y-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
            <p className="flex items-center gap-1.5 font-medium text-ok"><Check weight="bold" aria-hidden /> Found {plural(result.calls.length, 'conversation')}</p>
            {result.warnings.map((w) => <p key={w} className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink-2"><Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />{w}</p>)}
            <ul className="max-h-72 space-y-2 overflow-y-auto rounded-xl border bg-muted/40 p-3">
              {result.calls.slice(0, 5).map((c, i) => (
                <li key={i} className="rounded-lg border bg-card p-3">
                  <p className="mb-1.5 text-xs text-muted-foreground">{c.external_id ? <Mono>{c.external_id}</Mono> : `Conversation ${i + 1}`} · {Array.isArray(c.transcript) ? plural(c.transcript.length, 'turn') : 'plain text'}</p>
                  {Array.isArray(c.transcript) ? (
                    <ul className="space-y-0.5 text-sm">
                      {c.transcript.slice(0, 4).map((t, j) => <li key={j} className="truncate"><span className="font-medium text-muted-foreground">{t.speaker}:</span> {t.text}</li>)}
                      {c.transcript.length > 4 && <li className="text-xs text-muted-foreground">…{plural(c.transcript.length - 4, 'more turn')}</li>}
                    </ul>
                  ) : <p className="line-clamp-3 text-sm">{c.transcript}</p>}
                </li>
              ))}
              {result.calls.length > 5 && <li className="px-1 text-xs text-muted-foreground">…and {plural(result.calls.length - 5, 'more conversation')}</li>}
            </ul>
          </motion.div>
        ) : (
          <motion.div key="input" className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Segmented id="alteria-calls-how" label="Transcripts from" value={how} onChange={(h) => (setHow(h), setError(undefined))}
              options={[{ value: 'text', label: 'Paste text' }, { value: 'file', label: 'Choose a file' }]} />
            {how === 'text' ? (
              <div className="space-y-1.5">
                <div className="flex items-end justify-between">
                  <Label htmlFor="alteria-text">Your transcripts</Label>
                  {!text && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setText(MESSY)}>Try an example</button>}
                </div>
                <Textarea id="alteria-text" rows={10} value={text} onChange={(e) => (setText(e.target.value), setError(undefined))} spellCheck={false}
                  placeholder={'Call 1042\nAgent: Hello, how can I help?\nCustomer: I want to book…\n\n---\n\nChat 1043\n…'} className="max-h-[45dvh] min-h-44 font-mono text-xs md:text-xs" />
                <p className="text-xs text-muted-foreground">Separate conversations with a blank line, --- or a heading like “Call 1042”. Any speaker labels work.</p>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-5 hover:border-muted-foreground/50 has-focus-visible:border-primary">
                <input type="file" accept=".txt,.md,.csv,.json,.jsonl,text/plain" className="sr-only" onChange={(e) => (setFile(e.target.files?.[0]), setError(undefined))} />
                <span className="grid size-10 place-items-center rounded-lg border bg-background text-primary"><FileArrowUp size={20} weight="duotone" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{file ? file.name : 'Choose a file of transcripts'}</span>
                  <span className="block text-sm text-muted-foreground">Text, Markdown, CSV or JSON, in any layout</span>
                </span>
              </label>
            )}
            <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck size={14} className="mt-px shrink-0" aria-hidden />alteria reads the text to reshape it and keeps nothing. It doesn't change what anyone said.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <Problem>{error}</Problem>}

      <DialogFooter className="sm:justify-between">
        {result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(undefined)}><ArrowLeft aria-hidden /> Change the input</Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => saveBlob(new Blob([json()], { type: 'application/json' }), 'conversations.json')}><DownloadSimple aria-hidden /> Download JSON</Button>
              <Button onClick={() => onUse(new File([json()], 'conversations-by-alteria.json', { type: 'application/json' }))}>Use {plural(result.calls.length, 'conversation')}</Button>
            </div>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={convert} disabled={busy}>{busy ? <AlteriaLoader size={16} /> : <AlteriaMark />} Convert with alteria</Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}

// ── Trackers ───────────────────────────────────────────────────────────────────

const GOALS = [
  'Calls to a dental clinic: did they book, why not, and did the bot frustrate anyone?',
  'Support chats: was the issue resolved, and did they ask for a person?',
  'Sales follow-ups: how interested were they, what objections came up, any competitors?',
]

export function AlteriaTrackersDialog({ open, onOpenChange, existing, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; existing: string[]; onImported: () => void }) {
  const opens = useOpens(open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <TrackersBody key={opens} existing={existing} onDone={() => { onImported(); onOpenChange(false) }} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function TrackersBody({ existing, onDone, onClose }: { existing: string[]; onDone: () => void; onClose: () => void }) {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<AlteriaTrackers>()
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const draft = async () => {
    if (goal.trim().length < 8) return setError('Tell alteria a little more: what the conversations are, and what you want to find out.')
    setBusy(true)
    setError(undefined)
    try {
      const r = await alteriaTrackers(goal.trim(), existing)
      setResult(r)
      setPicked(new Set(r.trackers.map((t) => t.name)))
    } catch (e) {
      setError(needsB38(e as ApiError))
    } finally {
      setBusy(false)
    }
  }
  const chosen = (): TrackerDraft[] => result?.trackers.filter((t) => picked.has(t.name)) ?? []
  const run = async () => {
    setImporting(true)
    setError(undefined)
    try {
      const r = await importTrackers(new File([JSON.stringify(chosen())], 'trackers-by-alteria.json'), { dryRun: false, onConflict: 'skip' })
      if (r.created.length) toast.success(`Added ${plural(r.created.length, 'tracker')}`, { description: r.skipped.length ? `Kept your ${r.skipped.map(title).join(', ')} as they were.` : 'Next: analyse some conversations with them.' })
      else toast(`Nothing new to add: you already have ${r.skipped.map(title).join(', ')}.`)
      onDone()
    } catch (e) {
      const err = e as ApiError
      setError(err.errors?.length ? err.errors.join(' ') : err.message)
      setImporting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <AlteriaMark size={20} className="text-primary" /> Let alteria draft your trackers
        </DialogTitle>
        <DialogDescription className="text-ink-2">
          Say what the conversations are and what you want to learn. alteria drafts trackers and signals, and you choose what to add.
        </DialogDescription>
      </DialogHeader>

      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Thinking lines={['Reading your goal…', 'Choosing what to track…', 'Writing each question…', 'Checking the options cover every case…']} />
          </motion.div>
        ) : result ? (
          <motion.div key="result" className="space-y-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
            {result.notes.map((n) => <p key={n} className="text-sm text-ink-2">{n}</p>)}
            <ul className="space-y-2">
              {result.trackers.map((t) => {
                const on = picked.has(t.name)
                return (
                  <li key={t.name} className={cn('rounded-xl border p-3 transition-colors', on ? 'bg-card' : 'bg-muted/40 opacity-70')}>
                    <label className="flex items-start gap-2.5">
                      <Checkbox className="mt-0.5" checked={on} onCheckedChange={(c) => setPicked((s) => { const n = new Set(s); if (c) n.add(t.name); else n.delete(t.name); return n })} />
                      <span className="min-w-0">
                        <span className="block font-semibold">{title(t.name)}{existing.includes(t.name) && <span className="ml-2 rounded-md bg-warn-soft px-1.5 text-xs font-medium text-warn">You have one</span>}</span>
                        {t.description && <span className="block text-sm text-muted-foreground">{t.description}</span>}
                      </span>
                    </label>
                    <ul className="mt-2 space-y-2 pl-7">
                      {t.signals.map((s) => <SignalPreview key={s.name} s={s} />)}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        ) : (
          <motion.div key="input" className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="space-y-1.5">
              <Label htmlFor="alteria-goal">What do you want to learn from your conversations?</Label>
              <Textarea id="alteria-goal" rows={4} autoFocus value={goal} maxLength={1000} onChange={(e) => (setGoal(e.target.value), setError(undefined))}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft()}
                placeholder="e.g. Inbound calls to our clinic. I want to know if they booked, why they didn't, and whether the bot upset anyone." />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Or start from one of these</p>
              <ul className="flex flex-wrap gap-1.5">
                {GOALS.map((g) => (
                  <li key={g}><button type="button" onClick={() => setGoal(g)} className="rounded-full border bg-card px-3 py-1 text-left text-xs transition-[border-color,transform] duration-150 hover:border-primary/50 active:scale-[0.97]">{g}</button></li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <Problem>{error}</Problem>}

      <DialogFooter className="sm:justify-between">
        {result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(undefined)} disabled={importing}><ArrowLeft aria-hidden /> Change the goal</Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!picked.size} onClick={() => saveBlob(new Blob([JSON.stringify(chosen(), null, 2)], { type: 'application/json' }), 'trackers.json')}><DownloadSimple aria-hidden /> Download JSON</Button>
              <Button onClick={run} disabled={!picked.size || importing}>{importing && <Loader />}Add {plural(picked.size, 'tracker')}</Button>
            </div>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={draft} disabled={busy}>{busy ? <AlteriaLoader size={16} /> : <AlteriaMark />} Draft with alteria</Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}

function SignalPreview({ s }: { s: SignalSpec }) {
  const opts = s.type === 'choice' ? Object.keys((s.criteria as Record<string, string>) ?? {}).map(title) : s.type === 'score' ? (s.criteria as string[]).map((l) => l.split(':')[0]) : ['Yes', 'No']
  return (
    <li className="text-sm">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{title(s.name)}</span>
        <TypeTag type={s.type} className="h-4.5 px-1 text-[0.6875rem]" />
      </span>
      <span className="block text-muted-foreground">{s.instructions}</span>
      <span className="mt-1 flex flex-wrap gap-1">{opts.map((o) => <span key={o} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-ink-2">{o}</span>)}</span>
    </li>
  )
}

// ── One signal, inside the wizard ──────────────────────────────────────────────

export function AlteriaSignalBox({ tracker, onDraft }: { tracker: string; onDraft: (spec: SignalSpec) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const draft = async () => {
    if (text.trim().length < 6) return setError('Write the question you want answered, like “Did the caller ask for a refund?”')
    setBusy(true)
    setError(undefined)
    try {
      const r = await alteriaSignal(text.trim(), tracker)
      onDraft(r.signal)
      if (r.notes.length) toast(r.notes.join(' '), { icon: <AlteriaMark className="text-primary" /> })
    } catch (e) {
      setError(needsB38(e as ApiError))
      setBusy(false)
    }
  }
  return (
    <div className="rounded-xl border border-primary/25 bg-primary-soft/40 p-3.5">
      <Label htmlFor="alteria-q" className="mb-2 flex items-center gap-1.5 text-sm"><AlteriaName /> <span className="font-normal text-ink-2">can draft it from your question</span></Label>
      <div className="flex gap-2">
        <Input id="alteria-q" value={text} placeholder="e.g. Did the caller ask for a refund?" disabled={busy} className="bg-card"
          onChange={(e) => (setText(e.target.value), setError(undefined))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); draft() } }} aria-invalid={!!error} />
        <Button type="button" onClick={draft} disabled={busy} className="shrink-0">{busy ? <AlteriaLoader size={16} /> : <AlteriaMark />} Draft</Button>
      </div>
      {error ? <p role="alert" className="mt-1.5 text-xs text-stop">{error}</p> : <p className="mt-1.5 text-xs text-muted-foreground">It picks the answer type, writes the instructions and options, and takes you to Review to check them.</p>}
    </div>
  )
}
