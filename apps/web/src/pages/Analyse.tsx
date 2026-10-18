import { ArrowCounterClockwise, ArrowRight, CaretRight, Check, Coins, CopySimple, FileArrowUp, FileText, Microphone, GitBranch, Info, Prohibit, StackSimple, Wallet } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AUDIO_EXTENSIONS, audioProblem, isAudio, MAX_AUDIO_MB } from '../audio'
import { createUpload, dryRun, getUpload, listTrackers, sampleFile, type Tracker, type UploadOut, type UploadStatus } from '../api'
import { reloadBilling } from '../billing'
import { Button } from '../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { dependentsOf, describe, gatesOf } from '../conditions'
import { money, num, plural, title } from '../lib/format'
import { STATUS_POLL_MS, useLoad, usePolling } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { PasteJson } from '../json-input'
import { ErrorNote, Mono, Num, PageHeader, Segmented } from '../ui'
import { numMoney } from '../currency'

type Step =
  | { step: 'pick' }
  | { step: 'checking'; file: File }
  | { step: 'confirm'; file: File; dry: UploadOut }
  | { step: 'running'; id: string; dry: UploadOut }

/** Trackers that can run: on, with at least one signal on, and (like the backend) whose gate can run too. */
function runnable(ts: Tracker[]) {
  let ok = ts.filter((t) => t.active && t.signals.some((s) => s.active))
  for (let dropped: Tracker[]; (dropped = ok.filter((t) => t.run_if && !ok.some((g) => g.name === t.run_if!.tracker))).length;) {
    ok = ok.filter((t) => !dropped.includes(t))
  }
  return ok
}

/** A choice the backend accepts: every conditional tracker comes with its gates. */
const withGates = (chosen: string[], ts: Tracker[]) => [...new Set(chosen.flatMap((n) => [n, ...gatesOf(n, ts)]))]
const names = (ns: string[]) => new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(ns.map(title))

// The last choice of trackers is remembered, since most people run the same ones each time.
const CHOSEN_KEY = 'analyse-trackers'
const readChosen = (): string[] | undefined => {
  try {
    return JSON.parse(localStorage.getItem(CHOSEN_KEY) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}

const ACCEPT = ['csv', 'json', 'jsonl', 'txt', 'vtt', 'srt', ...AUDIO_EXTENSIONS].map((e) => `.${e}`).join(',')

export default function Analyse() {
  const trackers = useLoad(listTrackers, [])
  const [chosen, setChosenState] = useState<string[] | undefined>(readChosen)
  const [s, setS] = useState<Step>({ step: 'pick' })
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [estimating, setEstimating] = useState(false)

  const usable = runnable(trackers.data ?? [])
  // Every runnable tracker is chosen until the user says otherwise; remembered ones that
  // can't run any more are dropped.
  const picked = withGates((chosen ?? usable.map((t) => t.name)).filter((n) => usable.some((t) => t.name === n)), usable)
  const setChosen = (next: string[]) => {
    setChosenState(next)
    try {
      localStorage.setItem(CHOSEN_KEY, JSON.stringify(next))
    } catch {
      // Not remembered; fine.
    }
  }

  const check = async (file: File) => {
    setError(undefined)
    const tooBig = audioProblem(file)
    if (tooBig) return setError(tooBig)
    setS({ step: 'checking', file })
    try {
      setS({ step: 'confirm', file, dry: await dryRun(file, picked) })
    } catch (e) {
      setError((e as Error).message)
      setS({ step: 'pick' })
    }
  }

  // On the confirmation screen, changing trackers re-runs the estimate.
  const seq = useRef(0)
  const rechoose = async (next: string[]) => {
    setChosen(next)
    if (s.step !== 'confirm' || !next.length) return
    const mine = ++seq.current
    setEstimating(true)
    setError(undefined)
    try {
      const dry = await dryRun(s.file, next)
      if (mine === seq.current) setS({ step: 'confirm', file: s.file, dry })
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message)
    } finally {
      if (mine === seq.current) setEstimating(false)
    }
  }

  const run = async (file: File, dry: UploadOut) => {
    setStarting(true)
    try {
      setS({ step: 'running', id: await createUpload(file, dry.trackers), dry })
      if (dry.charge) void reloadBilling() // the hold came out of the credits
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Analyse calls">
        Add a file of calls. You'll see what it uses before anything runs.
      </PageHeader>
      <Steps current={s.step === 'pick' ? 0 : s.step === 'running' ? 2 : 1} />
      {error && <ErrorNote className="mb-6">{error}</ErrorNote>}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={s.step}
          initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.25, ease } }}
          exit={{ opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.12 } }}
        >
          {s.step === 'pick' && (
            <Pick trackers={trackers.data} usable={usable} loading={trackers.loading} chosen={picked} onChoose={setChosen} onFile={check} />
          )}
          {s.step === 'checking' && <Checking name={s.file.name} />}
          {s.step === 'confirm' && (
            <Confirm
              dry={s.dry}
              usable={usable}
              chosen={picked}
              onChoose={rechoose}
              estimating={estimating}
              starting={starting}
              onRun={() => run(s.file, s.dry)}
              onBack={() => setS({ step: 'pick' })}
            />
          )}
          {s.step === 'running' && <Running id={s.id} dry={s.dry} onAnother={() => setS({ step: 'pick' })} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2 text-sm" aria-label="Steps">
      {['Add a file', 'Confirm', 'Analyse'].map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          {i > 0 && <span className={cn('h-px w-6 transition-colors duration-300 sm:w-10', i <= current ? 'bg-primary' : 'bg-border')} aria-hidden />}
          <span
            className={cn(
              'grid size-5 place-items-center rounded-full border text-[0.6875rem] font-semibold transition-colors duration-300',
              i < current ? 'border-primary bg-primary text-primary-foreground' : i === current ? 'border-primary text-primary' : 'text-muted-foreground',
            )}
          >
            {i < current ? <Check size={10} weight="bold" aria-hidden /> : i + 1}
          </span>
          <span className={i === current ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
        </li>
      ))}
    </ol>
  )
}

/** Trackers as toggle chips. Picking a conditional tracker picks its gate; dropping a gate drops
 *  the trackers that depend on it, since they couldn't run without it. */
function TrackerChips({ usable, chosen, onChoose }: { usable: Tracker[]; chosen: string[]; onChoose: (c: string[]) => void }) {
  const [note, setNote] = useState<string>()
  const toggle = (name: string) => {
    let next: string[]
    if (chosen.includes(name)) {
      const deps = dependentsOf(name, usable).filter((d) => chosen.includes(d))
      next = chosen.filter((n) => n !== name && !deps.includes(n))
      setNote(deps.length ? `Also removed ${deps.map(title).join(', ')}: ${deps.length === 1 ? 'it runs' : 'they run'} only when ${title(name)}'s answer matches.` : undefined)
    } else {
      const gates = gatesOf(name, usable).filter((g) => !chosen.includes(g))
      next = [...chosen, name, ...gates]
      setNote(gates.length ? `Also added ${gates.map(title).join(', ')}: ${title(name)} runs only when ${gates.length === 1 ? 'its' : 'their'} answer matches.` : undefined)
    }
    onChoose(usable.map((t) => t.name).filter((n) => next.includes(n)))
  }
  return (
    <>
    <ul className="flex flex-wrap gap-2" aria-label="Trackers to run">
      {usable.map((t) => {
        const on = chosen.includes(t.name)
        const count = t.signals.filter((s) => s.active).length
        return (
          <li key={t.name}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.name)}
              title={t.description ?? undefined}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border pr-3.5 pl-2 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]',
                on ? 'border-primary/50 bg-primary-soft text-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('grid size-5 place-items-center rounded-full border transition-colors duration-150', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.1 } }} transition={{ type: 'spring', visualDuration: 0.2, bounce: 0.3 }}>
                      <Check size={11} weight="bold" aria-hidden />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              {title(t.name)}
              {t.run_if && (
                <span className="inline-flex items-center gap-0.5 text-xs font-normal text-primary" title={`Only when ${title(t.run_if.tracker)}: ${describe(t.run_if, usable)}`}>
                  <GitBranch size={11} weight="bold" aria-hidden />
                  <span className="sr-only">Only when {title(t.run_if.tracker)}: {describe(t.run_if, usable)}.</span>
                  if {title(t.run_if.tracker)}
                </span>
              )}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
            </button>
          </li>
        )
      })}
    </ul>
    <AnimatePresence initial={false}>
      {note && (
        <motion.p key={note} className="mt-2 text-sm text-ink-2" aria-live="polite" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
          {note}
        </motion.p>
      )}
    </AnimatePresence>
    </>
  )
}

function Pick({ trackers, usable, loading, chosen, onChoose, onFile }: {
  trackers?: Tracker[]
  usable: Tracker[]
  loading: boolean
  chosen: string[]
  onChoose: (c: string[]) => void
  onFile: (f: File) => void
}) {
  const [over, setOver] = useState(false)
  const [how, setHow] = useState<'file' | 'paste'>('file')
  const none = chosen.length === 0
  const noTrackers = trackers && usable.length === 0

  if (noTrackers) {
    return (
      <div className="surface px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">First, decide what to track</h2>
        <p className="mx-auto mt-1 max-w-[46ch] text-ink-2">Calls are analysed with your trackers. Set one up (it takes a minute, or pick a ready-made one), then come back here.</p>
        <Button asChild className="mt-5"><Link to="/trackers">Set up a tracker <ArrowRight weight="bold" aria-hidden /></Link></Button>
      </div>
    )
  }

  return (
    <div>
      <Segmented id="analyse-how" label="How to add conversations" className="mb-3" value={how} onChange={setHow}
        options={[{ value: 'file', label: 'Upload a file' }, { value: 'paste', label: 'Paste JSON' }]} />
      {how === 'paste' ? (
        <div className={cn('surface p-5', none && 'pointer-events-none opacity-60')}>
          <PasteJson kind="calls" onUse={onFile} busy={none} action="Check these conversations" />
        </div>
      ) : (
      <label
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f && !none) onFile(f)
        }}
        aria-disabled={none}
        className={cn(
          'group relative flex min-h-72 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed px-6 py-12 text-center transition-[border-color,background-color] duration-200 has-focus-visible:border-primary',
          over ? 'border-primary bg-primary-soft' : 'bg-card hover:border-muted-foreground/50',
          none && 'pointer-events-none opacity-60',
        )}
      >
        <input type="file" accept={ACCEPT} className="sr-only" disabled={none} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <motion.span
          animate={over ? { y: -6, scale: 1.06 } : { y: 0, scale: 1 }}
          transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.3 }}
          className="grid size-14 place-items-center rounded-2xl border bg-background text-primary shadow-panel"
        >
          <FileArrowUp size={28} weight="duotone" aria-hidden />
        </motion.span>
        <span className="mt-5 text-lg font-semibold tracking-tight">{over ? 'Drop to check it' : 'Drop a file of calls or a recording here'}</span>
        <span className="mt-1 text-sm text-ink-2">Transcripts as they are: CSV, JSON, JSONL, text or subtitles, up to 50 MB</span>
        <span className="mt-1 text-sm text-ink-2">Or a recording: MP3, WAV, M4A, OGG, WebM or FLAC, up to {MAX_AUDIO_MB} MB. Gemini transcribes it first.</span>
        <span className="mt-5 inline-flex h-9 items-center rounded-lg border bg-background px-3.5 text-sm font-medium shadow-panel transition-transform duration-150 group-active:scale-[0.97]">
          Choose file
        </span>
      </label>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button variant="ghost" size="sm" className="-ml-2 text-primary hover:text-primary" disabled={none} onClick={() => onFile(sampleFile())}>
          <FileText aria-hidden /> Try the sample file
        </Button>
        <FileHelp />
      </div>

      <section className="mt-8" aria-labelledby="run-h">
        <h2 id="run-h" className="mb-3 text-sm font-medium">Check these calls for</h2>
        {loading && !trackers ? (
          <div className="flex gap-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-9 w-32 rounded-full" />)}</div>
        ) : (
          <>
            <TrackerChips usable={usable} chosen={chosen} onChoose={onChoose} />
            {none && <p className="mt-2 text-sm text-stop" role="alert">Choose at least one tracker.</p>}
          </>
        )}
      </section>
    </div>
  )
}

function FileHelp() {
  return (
    <Collapsible className="text-muted-foreground">
      <CollapsibleTrigger className="group inline-flex items-center gap-1 hover:text-foreground">
        <CaretRight size={11} weight="bold" className="transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden />
        What the file needs
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <p className="mt-3 max-w-md text-ink-2">Any layout works: aftercall reads speaker labels, timestamps and turns from CSV, JSON, JSONL, plain text (<Mono>Agent: …</Mono> lines), and VTT or SRT subtitles. Recordings (MP3, WAV, M4A, OGG, WebM, FLAC) are transcribed by Gemini first, with a speaker on every turn, then analysed the same way. It shows what it found before anything runs. These fields help:</p>
        <dl className="mt-3 grid max-w-md gap-2.5 text-ink-2">
          {[
            ['transcript', 'The conversation. Text, or a list of turns with a speaker and text.'],
            ['external_id', 'Your call ID. Calls already analysed with the same ID are skipped.'],
            ['agent_id, agent_version', 'Lets you compare agent versions.'],
            ['started_at', 'When the call started.'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt><Mono className="font-medium text-foreground">{k}</Mono></dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Checking({ name }: { name: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="shimmer-text inline-block font-medium">Checking {name}…</p>
      <div className="skeleton mt-5 h-10 w-80 max-w-full" />
      <div className="skeleton mt-6 h-9 w-96 max-w-full rounded-full" />
      <div className="skeleton mt-8 h-28 w-full rounded-xl" />
      <div className="skeleton mt-3 h-14 w-full rounded-xl" />
    </div>
  )
}

function Confirm({ dry, usable, chosen, onChoose, estimating, starting, onRun, onBack }: {
  dry: UploadOut
  usable: Tracker[]
  chosen: string[]
  onChoose: (c: string[]) => void
  estimating: boolean
  starting: boolean
  onRun: () => void
  onBack: () => void
}) {
  const large = dry.flagged.filter((f) => f.flag === 'large')
  const over = dry.flagged.filter((f) => f.flag === 'over_limit')
  const { estimate: est } = dry
  const stale = estimating || chosen.join() !== dry.trackers.join()
  const audio = isAudio(dry.filename)
  const tokens = est.tokens
  const largeTokens = large.reduce((s, f) => s + f.estimated_tokens, 0)
  const upTo = dry.conditional.length > 0
  const charge = dry.charge
  const short = !!charge && charge.shortfall > 0
  // With billing on, what comes out of credits (after Pro's included tokens), not the list price.
  const cost = charge ? charge.cost : est.cost
  const covered = !!charge && charge.cost === 0 && charge.included_tokens > 0

  return (
    <div className="pb-28">
      <h2 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">
        <Num value={dry.queued} /> {dry.queued === 1 ? 'call' : 'calls'} ready to analyse
      </h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><FileText aria-hidden /> {dry.filename}{dry.received !== dry.queued && `, ${dry.received} in the file`}</p>

      <section className="mt-6" aria-labelledby="cats-h">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h3 id="cats-h" className="text-sm font-medium">Check them for</h3>
          <AnimatePresence>
            {stale && chosen.length > 0 && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shimmer-text text-sm font-medium" aria-live="polite">
                Updating the estimate…
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <TrackerChips usable={usable} chosen={chosen} onChoose={onChoose} />
        {chosen.length === 0 && <p className="mt-2 text-sm text-stop" role="alert">Choose at least one tracker.</p>}
      </section>

      <div className={cn('transition-opacity duration-200', stale && 'opacity-55')}>
        <div className="surface mt-8 px-5 py-5">
          <p className="text-sm text-muted-foreground">Estimated use</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {tokens === null ? 'Estimated after transcription' : <>{upTo ? 'Up to' : 'About'} <Num value={tokens} /> tokens</>}
            {covered ? (
              <span className="text-muted-foreground">, included in Pro</span>
            ) : cost !== null && (
              <span className="text-muted-foreground">, <Num {...numMoney(cost)} /></span>
            )}
          </p>
          {audio && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-2">
              <Microphone size={14} weight="fill" className="mt-0.5 shrink-0 text-primary" aria-hidden />
              Gemini transcribes the recording first, in the background. Once there is a transcript, the calls are queued and analysed, and the tokens are counted.
            </p>
          )}
          <p className="mt-1 text-sm text-ink-2">
            {plural(dry.signals, 'signal')} from {names(dry.trackers)}, on {plural(dry.queued, 'call')}.
            {est.cost === null && ' Pricing isn\'t set yet, so this is tokens only.'}
          </p>
          {upTo && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-2">
              <GitBranch size={14} weight="bold" className="mt-0.5 shrink-0 text-primary" aria-hidden />
              {names(dry.conditional)} {dry.conditional.length === 1 ? 'runs' : 'run'} only on calls where {dry.conditional.length === 1 ? 'its condition holds' : 'their conditions hold'}, so this is the most it can use.
            </p>
          )}
          {charge && !short && (
            <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t pt-3 text-sm text-ink-2">
              <Coins size={14} className="shrink-0 text-primary" aria-hidden />
              <span>
                {charge.included_tokens > 0 && <>{num(charge.included_tokens)} tokens from Pro's included tokens{charge.cost > 0 ? ', and ' : '.'}</>}
                {(charge.cost > 0 || !charge.included_tokens) && <>{money(charge.cost)} held from your credits. <span className="text-muted-foreground">{money(charge.balance_after)} left after it.</span></>}
              </span>
              <span className="basis-full text-xs text-muted-foreground">Each call is charged what it actually uses, and the rest comes back.</span>
            </p>
          )}
        </div>
        {short && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-stop/20 bg-stop-soft px-4 py-3">
            <Wallet size={18} weight="fill" className="shrink-0 text-stop" aria-hidden />
            {/* The backend's words, as they are. */}
            <p className="min-w-0 flex-1 basis-64 text-sm">{charge!.message}</p>
            <Button size="sm" variant="outline" asChild><Link to="/settings/credits/add">Add credits</Link></Button>
          </div>
        )}

        <ul className="mt-3 space-y-2">
          <AnimatePresence initial={false}>
            {large.length > 0 && (
              <Notice key="large" tone="warn" icon={<StackSimple size={18} weight="fill" aria-hidden />}
                summary={<>{large.length === 1 ? '1 long call is' : `${large.length} long calls are`} sent in parts, using {Math.round((largeTokens / (tokens ?? 1)) * 100)}% of the tokens</>}
              >
                <p>Each part carries the whole transcript, so these cost more than a call that fits in one go. Checking for fewer trackers can bring them back to one part.</p>
                <ul className="mt-3 space-y-2">
                  {large.map((f) => (
                    <li key={f.row}>
                      <span className="font-medium"><Mono>{f.external_id ?? `Row ${f.row}`}</Mono></span>
                      <span className="text-muted-foreground">: {f.requests} parts, {num(f.estimated_tokens)} tokens ({f.multiplier}× a single part)</span>
                    </li>
                  ))}
                </ul>
                <Ledger dry={dry} />
              </Notice>
            )}
            {over.length > 0 && (
              <Notice key="over" tone="stop" icon={<Prohibit size={18} weight="bold" aria-hidden />}
                summary={<>{over.length === 1 ? '1 call is' : `${over.length} calls are`} too long to analyse. {over.length === 1 ? "It's" : "They're"} skipped, and not charged</>}
              >
                <p>{over[0].message}</p>
                <p className="mt-2 text-muted-foreground">{over.map((f) => f.external_id ?? `Row ${f.row}`).join(', ')}</p>
              </Notice>
            )}
            {dry.duplicates > 0 && (
              <Notice key="dup" tone="info" icon={<CopySimple size={18} aria-hidden />}
                summary={<>{dry.duplicates === 1 ? '1 call was' : `${dry.duplicates} calls were`} already analysed and will be skipped</>}
              >
                <p>Matched by <Mono>external_id</Mono>. Their earlier results are unchanged.</p>
              </Notice>
            )}
          </AnimatePresence>
        </ul>
        {!large.length && !over.length && !dry.duplicates && (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Check size={16} weight="bold" className="text-ok" aria-hidden /> Every call fits in one go.</p>
        )}
      </div>

      {/* Portalled: the page's entrance animation leaves a transform on its ancestors, which
          would pin a fixed bar to them instead of the window. */}
      {createPortal(<motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/85 backdrop-blur-md md:left-[240px]"
      >
        <div className="mx-auto flex max-w-[calc(48rem+2rem)] items-center justify-end gap-3 px-4 py-3">
          <span className="mr-auto hidden text-sm text-ink-2 sm:block">
            {tokens === null ? 'Estimated after transcription' : <>{upTo ? 'Up to' : 'About'} <Num value={tokens} className="font-medium text-foreground" /> tokens</>}{covered ? ', included in Pro' : cost !== null && `, ${money(cost)}`}
          </span>
          <Button variant="outline" size="lg" onClick={onBack}>Back</Button>
          <Button size="lg" onClick={onRun} disabled={starting || stale || short || dry.queued === 0 || chosen.length === 0}>
            {starting ? 'Starting…' : dry.queued === 0 ? 'Nothing to analyse' : <>Analyse {plural(dry.queued, 'call')} <ArrowRight weight="bold" aria-hidden /></>}
          </Button>
        </div>
      </motion.div>, document.body)}
    </div>
  )
}

const TONES = {
  warn: 'border-warn/25 bg-warn-soft [&_[data-icon]]:text-warn',
  stop: 'border-stop/20 bg-stop-soft [&_[data-icon]]:text-stop',
  info: 'bg-card [&_[data-icon]]:text-muted-foreground',
}

/** One line that says what happens; the reasons and the call list open underneath. */
function Notice({ tone, icon, summary, children }: { tone: keyof typeof TONES; icon: ReactNode; summary: ReactNode; children: ReactNode }) {
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease }} className={cn('rounded-xl border', TONES[tone])}>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
          <span data-icon className="shrink-0">{icon}</span>
          <span className="flex-1 text-[0.9375rem] font-medium">{summary}</span>
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground group-hover:text-foreground">
            <Info size={14} aria-hidden /> <span className="hidden sm:inline">Details</span>
            <CaretRight size={11} weight="bold" className="transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="max-w-[75ch] px-4 pb-4 pl-11 text-[0.9375rem] leading-relaxed">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </motion.li>
  )
}

/** The upload as one strip: each long call is its own segment, split into its parts;
 *  everything else shares one segment. Built only from the dry-run response. */
function Ledger({ dry }: { dry: UploadOut }) {
  const large = dry.flagged.filter((f) => f.flag === 'large')
  const total = dry.estimate.tokens ?? 0
  const rest = total - large.reduce((s, f) => s + f.estimated_tokens, 0)
  const others = dry.queued - large.length
  return (
    <div className="mt-4">
      <div className="flex h-8 gap-0.5 overflow-hidden rounded-lg" role="img" aria-label={`Tokens: ${large.map((f) => `${f.external_id} ${num(f.estimated_tokens)}`).join(', ')}${others ? `, ${others} other calls ${num(rest)}` : ''}`}>
        {large.map((f, i) => (
          <div key={f.row} className="ledger-seg flex gap-0.5" style={{ flexGrow: f.estimated_tokens, ['--i' as string]: i }}>
            {Array.from({ length: f.requests }, (_, p) => <div key={p} className="flex-1 bg-warn" />)}
          </div>
        ))}
        {others > 0 && <div className="ledger-seg min-w-1.5 bg-primary" style={{ flexGrow: rest, ['--i' as string]: large.length }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-warn" aria-hidden /> Long calls, {num(total - rest)} tokens</span>
        {others > 0 && <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-primary" aria-hidden /> {plural(others, 'other call')}, {num(rest)} tokens</span>}
      </div>
    </div>
  )
}

function Running({ id, dry, onAnother }: { id: string; dry: UploadOut; onAnother: () => void }) {
  const [st, setSt] = useState<UploadStatus>()
  usePolling(async () => {
    const next = await getUpload(id)
    setSt(next)
    return !next.complete
  }, STATUS_POLL_MS, true)

  const c = st?.counts
  const total = dry.queued
  const finished = c ? c.done + c.failed : 0
  const done = !!st?.complete
  return (
    <div aria-live="polite">
      <div className="flex items-center gap-3">
        <AnimatePresence>{done && <DrawnCheck />}</AnimatePresence>
        <motion.h2 layout="position" className="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">
          {done ? <><Num value={c!.done} /> calls analysed</> : <>{c?.transcribing ? 'Transcribing and analysing' : 'Analysing'} <Num value={total} /> calls</>}
        </motion.h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">For {names(dry.trackers)}</p>

      <div className="mt-7 flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished} aria-label="Calls finished">
        {Array.from({ length: total }, (_, i) => {
          const state = i < finished ? 'done' : i === finished && (c?.processing || c?.transcribing) ? 'working' : 'waiting'
          return (
            <span key={i} className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <motion.span
                className="absolute inset-0 origin-left rounded-full bg-primary"
                initial={false}
                animate={{ scaleX: state === 'done' ? 1 : 0 }}
                transition={{ duration: 0.45, ease }}
              />
              {state === 'working' && <span className="absolute inset-0 animate-pulse rounded-full bg-primary/35" />}
            </span>
          )
        })}
      </div>
      <p className="mt-3 text-ink-2">
        {c ? [`${c.done} done`, c.transcribing && `${c.transcribing} transcribing`, c.processing && `${c.processing} in progress`, c.queued && `${c.queued} waiting`, c.failed && `${c.failed} failed`, c.over_limit && `${c.over_limit} skipped (too long)`].filter(Boolean).join(', ') : 'Starting…'}
      </p>
      {!done && <p className="mt-1 text-sm text-muted-foreground">You can leave this page. Calls keep being analysed.</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg" variant={done ? 'default' : 'outline'}>
          <Link to={`/results/${id}`}>See results <ArrowRight weight="bold" aria-hidden /></Link>
        </Button>
        <Button variant="ghost" size="lg" onClick={onAnother}>
          <ArrowCounterClockwise aria-hidden /> Analyse another file
        </Button>
      </div>
    </div>
  )
}

/** Success: the circle pops in and the check draws itself. */
function DrawnCheck() {
  return (
    <motion.svg
      viewBox="0 0 32 32"
      width={32}
      height={32}
      aria-hidden
      initial={{ scale: 0.6, opacity: 0, filter: 'blur(4px)' }}
      animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
      transition={{ type: 'spring', visualDuration: 0.4, bounce: 0.35 }}
    >
      <circle cx="16" cy="16" r="16" fill="var(--ok)" />
      <motion.path
        d="M9.5 16.5l4.5 4.5 8.5-9"
        fill="none"
        stroke="white"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.15, duration: 0.35, ease }}
      />
    </motion.svg>
  )
}
