// The step-by-step modal for adding or editing a signal, and for creating a tracker
// (which then goes straight on to its first signal).
import { ArrowLeft, ArrowRight, CaretDown, Check, CheckSquare, Gauge, ListBullets, PencilSimple, Plus, Power, Sparkle, Trash } from '@phosphor-icons/react'
import { Loader } from './loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from './lib/toast'
import { deactivateSignal, deleteSignal, estimateTokens, saveSignal, saveTracker, TEMPLATES, type Condition, type Signal, type SignalSpec, type SignalType, type Tracker } from './api'
import { AlteriaSignalBox } from './alteria'
import { ConditionPicker } from './condition-picker'
import { conditionError, dependentsOf } from './conditions'
import { turnOff } from './turn-off'
import { Button } from './components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Slider } from './components/ui/slider'
import { Textarea } from './components/ui/textarea'
import { num, pct, plural, title, typeLabel } from './lib/format'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { blank, fromSpec, slug, toSpec, validate, validateTracker, type Draft } from './signal-draft'
import { ConfirmDelete } from './confirm-delete'
import { ErrorNote, Meter } from './ui'

export type WizardMode =
  | { kind: 'new-tracker' }
  | { kind: 'new-signal'; tracker: string }
  | { kind: 'edit'; tracker: string; signal: Signal }

type StepId = 'tracker' | 'type' | 'signal' | 'answers' | 'review'
const STEP_LABEL: Record<StepId, string> = { tracker: 'Tracker', type: 'Answer type', signal: 'Signal', answers: 'Answers', review: 'Review' }

const TYPES: { type: SignalType; Icon: typeof Gauge; ask: string; example: string; answers: string[] }[] = [
  { type: 'yes_no', Icon: CheckSquare, ask: 'Did it happen?', example: 'Did the caller ask for a human?', answers: ['Yes', 'No'] },
  { type: 'choice', Icon: ListBullets, ask: 'Which one was it?', example: 'How did the call end?', answers: ['Booked', 'Declined', 'Other'] },
  { type: 'score', Icon: Gauge, ask: 'How much?', example: 'How frustrated was the caller?', answers: ['0', '1', '2', '3'] },
]

export function SignalWizard({ open, mode, trackers, onClose, onSaved }: {
  open: boolean
  mode?: WizardMode
  trackers: Tracker[]
  onClose: () => void
  onSaved: (tracker: string) => void
}) {
  // Closing with unsaved work asks first, in the footer rather than a second dialog.
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // A new body per opening, so every run starts clean.
  const [opens, setOpens] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setOpens((n) => n + 1)
      setDirty(false)
      setConfirming(false)
    }
  }
  const requestClose = () => (dirty ? setConfirming(true) : onClose())

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        className="flex max-h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 p-0 sm:max-w-[640px]"
        showCloseButton={false}
        // Steps with no field to start in (edit opens on Review) focus the dialog itself, not the step bar.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
      >
        {mode && <Body key={opens} mode={mode} trackers={trackers} confirming={confirming} setConfirming={setConfirming} onDirty={setDirty} requestClose={requestClose} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ mode, trackers, confirming, setConfirming, onDirty, requestClose, onClose, onSaved }: {
  mode: WizardMode
  trackers: Tracker[]
  confirming: boolean
  setConfirming: (c: boolean) => void
  onDirty: (d: boolean) => void
  requestClose: () => void
  onClose: () => void
  onSaved: (tracker: string) => void
}) {
  const editing = mode.kind === 'edit' ? mode.signal : undefined
  const steps: StepId[] = mode.kind === 'new-tracker' ? ['tracker', 'type', 'signal', 'answers', 'review'] : mode.kind === 'new-signal' ? ['type', 'signal', 'answers', 'review'] : ['signal', 'answers', 'review']
  const [at, setAt] = useState(editing ? steps.length - 1 : 0)
  const [seen, setSeen] = useState(editing ? steps.length - 1 : 0)
  const [dir, setDir] = useState(1)
  const [tried, setTried] = useState<Partial<Record<StepId, boolean>>>({})

  const [trackerLabel, setTrackerLabel] = useState('')
  const [trackerDesc, setTrackerDesc] = useState('')
  const [trackerCond, setTrackerCond] = useState<Condition | null>(null)
  const [initial] = useState<Draft>(() => (editing ? fromSpec(editing.spec) : blank()))
  const [d, setD] = useState<Draft>(initial)
  const [label, setLabel] = useState(editing ? title(editing.name) : '')
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))

  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string>()
  const trackerCreated = useRef(false)

  const trackerKey = mode.kind === 'new-tracker' ? slug(trackerLabel) : mode.tracker
  const target = trackers.find((t) => t.name === trackerKey)
  const takenSignals = editing ? [] : (target?.signals.map((s) => s.name) ?? [])
  const trackerErrors = validateTracker(trackerKey, trackerDesc, trackers.map((t) => t.name))
  const errors = validate(d, takenSignals)
  const stepErrors = (s: StepId): string[] =>
    s === 'tracker' ? [...Object.values(trackerErrors), conditionError(trackerCond, trackerKey, trackers)].filter(Boolean) as string[]
    : s === 'signal' ? [errors.name, errors.instructions].filter(Boolean) as string[]
    : s === 'answers' ? [errors.criteria].filter(Boolean) as string[]
    : []

  const dirty = editing ? JSON.stringify(d) !== JSON.stringify(initial) : at > 0 || !!trackerLabel || !!label || !!trackerCond
  useEffect(() => onDirty(dirty && !saving), [dirty, saving, onDirty])

  const step = steps[at]
  const go = (i: number) => {
    setDir(i > at ? 1 : -1)
    setAt(i)
    setSeen((s) => Math.max(s, i))
    setConfirming(false)
  }
  const bodyRef = useRef<HTMLDivElement>(null)
  const next = () => {
    setTried((t) => ({ ...t, [step]: true }))
    if (stepErrors(step).length) {
      requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus())
      return
    }
    if (step === 'review') return void save()
    go(at + 1)
  }

  const save = async () => {
    // A mistake on an earlier step (possible after jumping around) sends you back to it.
    const bad = steps.findIndex((s) => stepErrors(s).length)
    if (bad >= 0) {
      setTried((t) => ({ ...t, [steps[bad]]: true }))
      return go(bad)
    }
    setSaving(true)
    setFailure(undefined)
    try {
      if (mode.kind === 'new-tracker' && !trackerCreated.current) {
        await saveTracker({ name: trackerKey, description: trackerDesc.trim() || null, run_if: trackerCond }, true)
        trackerCreated.current = true
      }
      const saved = await saveSignal(trackerKey, toSpec(d), !editing)
      toast.success(editing ? `Saved ${title(saved.name)}` : `Added ${title(saved.name)} to ${title(trackerKey)}`)
      onSaved(trackerKey)
    } catch (e) {
      setFailure((e as Error).message)
      setSaving(false)
    }
  }

  const createEmptyTracker = async () => {
    setTried((t) => ({ ...t, tracker: true }))
    if (stepErrors('tracker').length) return
    setSaving(true)
    try {
      await saveTracker({ name: trackerKey, description: trackerDesc.trim() || null, run_if: trackerCond }, true)
      toast.success(`Created ${title(trackerKey)}. Add signals whenever you're ready.`)
      onSaved(trackerKey)
    } catch (e) {
      setFailure((e as Error).message)
      setSaving(false)
    }
  }

  const applyTemplate = async (t: (typeof TEMPLATES)[number]) => {
    setSaving(true)
    try {
      await saveTracker({ name: t.name, description: t.description }, true)
      for (const s of t.signals) await saveSignal(t.name, s, true)
      toast.success(`Added ${title(t.name)} with ${plural(t.signals.length, 'signal')}`)
      onSaved(t.name)
    } catch (e) {
      setFailure((e as Error).message)
      setSaving(false)
    }
  }

  const applyExample = (spec: SignalSpec) => {
    setD(fromSpec(spec))
    setLabel(title(spec.name))
    setDir(1)
    setAt(steps.length - 1)
    setSeen(steps.length - 1)
  }

  const heading: Record<StepId, [string, string]> = {
    tracker: ['What do you want to track?', 'A tracker groups related signals, like Compliance or Customer experience. You choose which trackers run each time you analyse calls.'],
    type: ['What kind of answer do you need?', 'The AI gives one of these for every call.'],
    signal: [editing ? 'The signal' : "What's the signal?", 'Name it, then tell the AI what to listen for, the way you\'d brief a colleague.'],
    answers:
      d.type === 'yes_no' ? ['When is it a yes?', 'Optional, but it helps the AI with borderline calls.']
      : d.type === 'choice' ? ['What are the possible answers?', 'The AI picks exactly one. Describe each in the words callers actually use.']
      : ['What does each level mean?', 'Lowest first. Between 2 and 10 levels.'],
    review: [editing ? title(editing.name) : 'Review and save', `Checked on every call ${mode.kind === 'new-tracker' ? 'this tracker' : title(trackerKey)} runs on.`],
  }

  const context =
    mode.kind === 'new-tracker' ? (at === 0 ? 'New tracker' : `New signal in ${title(trackerKey) || 'your tracker'}`)
    : mode.kind === 'new-signal' ? `New signal in ${title(mode.tracker)}`
    : `Signal in ${title(mode.tracker)}`

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => (e.preventDefault(), next())}
      onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), next())}
    >
      <header className="border-b px-6 pt-5 pb-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-muted-foreground">{context}</span>
          <Stepper steps={steps} at={at} seen={editing ? steps.length - 1 : seen} onGo={go} />
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={step + (step === 'answers' ? d.type : '')} initial={{ opacity: 0, filter: 'blur(3px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.2 }}>
            <DialogTitle className="mt-3 text-xl font-semibold tracking-tight">{heading[step][0]}</DialogTitle>
            <DialogDescription className="mt-1 text-ink-2">{heading[step][1]}</DialogDescription>
          </motion.div>
        </AnimatePresence>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AutoHeight>
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={{
                enter: (dir: number) => ({ opacity: 0, x: dir * 24, filter: 'blur(2px)' }),
                center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.25, ease } },
                exit: (dir: number) => ({ opacity: 0, x: dir * -16, filter: 'blur(2px)', transition: { duration: 0.12 } }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              className="px-6 py-6"
            >
              {step === 'tracker' && (
                <TrackerStep
                  label={trackerLabel} setLabel={setTrackerLabel} desc={trackerDesc} setDesc={setTrackerDesc}
                  keyName={trackerKey} errors={tried.tracker ? trackerErrors : {}}
                  cond={trackerCond} setCond={setTrackerCond} trackers={trackers} showCondErrors={!!tried.tracker}
                  templates={TEMPLATES.filter((t) => !trackers.some((x) => x.name === t.name))}
                  onTemplate={applyTemplate} busy={saving}
                />
              )}
              {step === 'type' && (
                <TypeStep
                  value={d.type}
                  onPick={(type) => { set({ type }); go(at + 1) }}
                  examples={TEMPLATES.flatMap((t) => t.signals).filter((s) => !takenSignals.includes(s.name))}
                  onExample={applyExample}
                  alteria={<AlteriaSignalBox tracker={trackerKey} onDraft={applyExample} />}
                />
              )}
              {step === 'signal' && (
                <SignalStep d={d} set={set} label={label} setLabel={(l) => { setLabel(l); set({ name: slug(l) }) }} locked={!!editing} errors={tried.signal ? errors : {}} />
              )}
              {step === 'answers' && <AnswersStep d={d} set={set} error={tried.answers ? errors.criteria : undefined} />}
              {step === 'review' && (
                <ReviewStep d={d} set={set} label={label} editing={editing} steps={steps} onEdit={(s) => go(steps.indexOf(s))} />
              )}
              {failure && <ErrorNote className="mt-6">{failure}</ErrorNote>}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
      </div>

      <footer className="border-t px-6 py-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {confirming ? (
            <motion.div key="confirm" className="flex flex-wrap items-center justify-end gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }} role="alert">
              <span className="mr-auto text-sm font-medium">{editing ? 'Discard your changes?' : 'Discard this signal?'}</span>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Keep editing</Button>
              <Button type="button" variant="destructive" onClick={onClose}>Discard</Button>
            </motion.div>
          ) : (
            <motion.div key="nav" className="flex flex-wrap items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
              {editing ? (
                <>
                  <TurnOff tracker={trackerKey} signal={editing} trackers={trackers} onDone={() => onSaved(trackerKey)} />
                  <DeleteSignal tracker={trackerKey} signal={editing} onDone={() => onSaved(trackerKey)} />
                </>
              ) : at > 0 ? (
                <Button type="button" variant="ghost" onClick={() => go(at - 1)}><ArrowLeft aria-hidden /> Back</Button>
              ) : (
                <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
              )}
              <span className={cn('ml-auto hidden text-xs text-muted-foreground', step !== 'type' && 'sm:block')}>
                <kbd className="font-sans">⌘</kbd> <kbd className="font-sans">Enter</kbd> to {step === 'review' ? 'save' : 'continue'}
              </span>
              {step === 'tracker' && (
                <Button type="button" variant="outline" disabled={saving} onClick={createEmptyTracker}>Create without signals</Button>
              )}
              {step !== 'type' && (
                <PrimaryButton
                  busy={saving}
                  disabled={!!editing && !dirty && step === 'review'}
                  label={step === 'review' ? (editing ? (dirty ? 'Save changes' : 'No changes') : 'Add signal') : 'Continue'}
                  final={step === 'review'}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </footer>
    </form>
  )
}

/** Named steps with a bar that fills as you go. Steps you've reached are clickable. */
function Stepper({ steps, at, seen, onGo }: { steps: StepId[]; at: number; seen: number; onGo: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s}>
          <button
            type="button"
            disabled={i > seen}
            onClick={() => onGo(i)}
            aria-current={i === at ? 'step' : undefined}
            aria-label={`${STEP_LABEL[s]}${i < at ? ', done' : ''}`}
            title={STEP_LABEL[s]}
            className="group grid h-6 place-items-center px-0.5 disabled:cursor-default"
          >
            <span className="relative block h-1.5 w-7 overflow-hidden rounded-full bg-muted transition-colors duration-150 group-enabled:group-hover:bg-muted-foreground/25 sm:w-9">
              <motion.span
                className="absolute inset-0 origin-left rounded-full bg-primary"
                initial={false}
                animate={{ scaleX: i <= at ? 1 : 0, opacity: i < at ? 0.55 : 1 }}
                transition={{ duration: 0.3, ease }}
              />
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/** Animates its height to fit what's inside, so the modal grows and shrinks between steps. */
function AutoHeight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <motion.div animate={{ height: h }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
      <div ref={ref}>{children}</div>
    </motion.div>
  )
}

function PrimaryButton({ busy, disabled, label, final }: { busy: boolean; disabled?: boolean; label: string; final?: boolean }) {
  return (
    <Button type="submit" disabled={busy || disabled} className="min-w-28">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={busy ? 'busy' : label}
          className="inline-flex items-center gap-1.5"
          initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.1 } }}
          transition={{ duration: 0.15 }}
        >
          {busy ? <><Loader /> Saving</> : final ? <><Check weight="bold" aria-hidden /> {label}</> : <>{label} <ArrowRight weight="bold" aria-hidden /></>}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}

function TurnOff({ tracker, signal, trackers, onDone }: { tracker: string; signal: Signal; trackers: Tracker[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  if (!signal.active) return null
  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground hover:text-stop"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await turnOff({
          label: title(signal.name),
          off: (force) => deactivateSignal(tracker, signal.name, force),
          undo: () => saveSignal(tracker, signal.spec, false),
          description: 'New calls won\'t check it. Past results are kept.',
          dependents: dependentsOf(tracker, trackers, signal.name),
          done: onDone,
        })
      }}
    >
      <Power aria-hidden /> Turn off
    </Button>
  )
}

function DeleteSignal({ tracker, signal, onDone }: { tracker: string; signal: Signal; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="ghost" className="text-muted-foreground hover:text-stop" onClick={() => setOpen(true)}>
        <Trash aria-hidden /> Delete
      </Button>
      <ConfirmDelete
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${title(signal.name)}?`}
        onConfirm={async () => {
          await deleteSignal(tracker, signal.name)
          toast.success(`Deleted ${title(signal.name)}`)
          onDone()
        }}
      >
        It will no longer be checked on new calls, and you can reuse its name. Past results keep their answers. To pause it instead, turn it off.
      </ConfirmDelete>
    </>
  )
}

// ── Steps ──────────────────────────────────────────────────────────────────────

function TrackerStep({ label, setLabel, desc, setDesc, keyName, errors, cond, setCond, trackers, showCondErrors, templates, onTemplate, busy }: {
  label: string
  setLabel: (s: string) => void
  desc: string
  setDesc: (s: string) => void
  keyName: string
  errors: { name?: string; description?: string }
  cond: Condition | null
  setCond: (c: Condition | null) => void
  trackers: Tracker[]
  showCondErrors: boolean
  templates: typeof TEMPLATES
  onTemplate: (t: (typeof TEMPLATES)[number]) => void
  busy: boolean
}) {
  return (
    <div className="space-y-6">
      <Field id="t-name" label="Name" error={errors.name} hint={keyName && !errors.name ? <>Shows in exports as <code className="font-mono">{keyName}</code></> : undefined}>
        <Input id="t-name" autoFocus value={label} placeholder="Compliance" autoComplete="off" onChange={(e) => setLabel(e.target.value)} aria-invalid={!!errors.name} aria-describedby="t-name-hint" className="h-10 text-base" />
      </Field>
      <Field id="t-desc" label="What's it for?" optional error={errors.description}>
        <Input id="t-desc" value={desc} placeholder="Did the agent stay within clinic policy" onChange={(e) => setDesc(e.target.value)} aria-invalid={!!errors.description} aria-describedby="t-desc-hint" />
      </Field>
      <ConditionPicker self={keyName} trackers={trackers} value={cond} onChange={setCond} showErrors={showCondErrors} />
      {templates.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Sparkle size={14} weight="fill" className="text-primary" aria-hidden /> Or start from a ready-made tracker</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {templates.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onTemplate(t)}
                  className="h-full w-full rounded-xl border bg-card px-3.5 py-3 text-left transition-[border-color,transform] duration-150 hover:border-primary/50 active:scale-[0.98] disabled:opacity-60"
                >
                  <span className="block font-medium">{title(t.name)}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{t.signals.map((s) => title(s.name)).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TypeStep({ value, onPick, examples, onExample, alteria }: {
  value: SignalType
  onPick: (t: SignalType) => void
  examples: SignalSpec[]
  onExample: (s: SignalSpec) => void
  alteria: ReactNode
}) {
  return (
    <div>
      {alteria}
      <p className="mt-6 mb-2.5 text-sm text-muted-foreground">Or choose the answer type yourself</p>
      <div role="group" aria-label="Answer type" className="grid gap-2.5 sm:grid-cols-3">
        {TYPES.map(({ type, Icon, ask, example, answers }, i) => (
          <button
            key={type}
            type="button"
            aria-pressed={type === value}
            onClick={() => onPick(type)}
            className={cn(
              'group flex flex-col rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow,transform] duration-150 hover:border-primary/50 hover:shadow-panel active:scale-[0.98]',
              type === value && 'border-primary/60',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary"><Icon size={18} weight="duotone" aria-hidden /></span>
              <span className="font-semibold">{typeLabel(type)}</span>
            </span>
            <span className="mt-3 text-sm font-medium">{ask}</span>
            <span className="mt-0.5 text-sm text-muted-foreground">{example}</span>
            <span className="mt-4 flex flex-wrap gap-1" aria-hidden>
              {answers.map((a, j) => (
                <motion.span
                  key={a}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 + i * 0.05 + j * 0.03, duration: 0.2, ease }}
                  className={cn('rounded-md px-1.5 py-0.5 text-xs font-medium', j === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-ink-2', type === 'score' && 'min-w-5 text-center tabular-nums')}
                >
                  {a}
                </motion.span>
              ))}
            </span>
          </button>
        ))}
      </div>
      {examples.length > 0 && (
        <div className="mt-7">
          <p className="mb-2 text-sm text-muted-foreground">Or start from an example</p>
          <ul className="flex flex-wrap gap-1.5">
            {examples.map((s) => (
              <li key={s.name}>
                <button type="button" onClick={() => onExample(s)} className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-sm transition-[border-color,transform] duration-150 hover:border-primary/50 active:scale-[0.97]">
                  <TypeIcon type={s.type} /> {title(s.name)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const TypeIcon = ({ type }: { type: SignalType }) => {
  const Icon = TYPES.find((t) => t.type === type)!.Icon
  return <Icon size={14} className="text-muted-foreground" aria-hidden />
}

function SignalStep({ d, set, label, setLabel, locked, errors }: {
  d: Draft
  set: (p: Partial<Draft>) => void
  label: string
  setLabel: (s: string) => void
  locked: boolean
  errors: { name?: string; instructions?: string }
}) {
  const ask = TYPES.find((t) => t.type === d.type)!
  return (
    <div className="space-y-6">
      <Field
        id="s-name"
        label="Name"
        error={errors.name}
        hint={locked ? "Names can't be changed, so past results stay matched." : d.name && <>Shows in exports as <code className="font-mono">{d.name}</code></>}
      >
        <Input id="s-name" autoFocus={!locked} disabled={locked} value={label} placeholder={d.type === 'yes_no' ? 'Asked for a human' : d.type === 'choice' ? 'Call outcome' : 'Caller frustration'} autoComplete="off"
          onChange={(e) => setLabel(e.target.value)} aria-invalid={!!errors.name} aria-describedby="s-name-hint" className="h-10 text-base" />
      </Field>
      <Field id="s-ins" label="What should the AI listen for?" error={errors.instructions} hint={d.type === 'yes_no' ? 'Ask about exactly one thing.' : 'Write it as a question about the call.'}>
        <Textarea id="s-ins" autoFocus={locked} className="min-h-28 resize-y text-[0.9375rem] leading-relaxed" value={d.instructions} placeholder={ask.example}
          onChange={(e) => set({ instructions: e.target.value })} aria-invalid={!!errors.instructions} aria-describedby="s-ins-hint" />
      </Field>
    </div>
  )
}

function AnswersStep({ d, set, error }: { d: Draft; set: (p: Partial<Draft>) => void; error?: string }) {
  return (
    <div>
      {d.type === 'yes_no' && (
        <div className="space-y-4">
          {(['yes', 'no'] as const).map((k, i) => (
            <Field key={k} id={`a-${k}`} label={k === 'yes' ? "It's a yes when…" : "It's a no when…"} optional>
              <Textarea id={`a-${k}`} autoFocus={i === 0} rows={2} className="resize-none leading-relaxed" value={d[k]}
                placeholder={k === 'yes' ? "The caller asks for a person, e.g. 'kisi insaan se baat karao'" : 'The caller never asks to be transferred'}
                onChange={(e) => set({ [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      )}

      {d.type === 'choice' && (
        <ul className="space-y-2.5">
          <AnimatePresence initial={false}>
            {d.options.map((o, i) => (
              <motion.li
                key={i}
                layout="position"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.2, ease }}
                className="rounded-xl border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <Input autoFocus={i === 0 && !o.key} className="h-8 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0" value={o.key} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1} name`}
                    onChange={(e) => set({ options: d.options.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                  <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-stop" aria-label={`Remove ${o.key || `answer ${i + 1}`}`}
                    onClick={() => set({ options: d.options.filter((_, j) => j !== i) })}>
                    <Trash aria-hidden />
                  </Button>
                </div>
                <Textarea rows={1} className="mt-1 min-h-9 resize-none border-0 bg-muted/60 leading-snug shadow-none" value={o.text} placeholder="Pick this when…" aria-label={`When to pick ${o.key || `answer ${i + 1}`}`}
                  onChange={(e) => set({ options: d.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              </motion.li>
            ))}
          </AnimatePresence>
          <li>
            <AddButton onClick={() => set({ options: [...d.options.slice(0, -1), { key: '', text: '' }, ...d.options.slice(-1)] })}>Add an answer</AddButton>
          </li>
        </ul>
      )}

      {d.type === 'score' && (
        <ol className="space-y-2">
          {d.levels.map((l, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr_auto] items-start gap-2">
              <span className="mt-1 grid size-7 place-items-center rounded-lg bg-primary-soft text-sm font-semibold text-primary tabular-nums">{i}</span>
              <Textarea autoFocus={i === 0} rows={1} className="min-h-9 resize-none leading-snug" value={l} placeholder={i === 0 ? 'Calm: polite or neutral throughout' : i === d.levels.length - 1 ? 'Angry: hostile, threatens to leave' : 'Describe this level'} aria-label={`Level ${i}`}
                onChange={(e) => set({ levels: d.levels.map((x, j) => (j === i ? e.target.value : x)) })} />
              <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-stop" aria-label={`Remove level ${i}`} onClick={() => set({ levels: d.levels.filter((_, j) => j !== i) })}>
                <Trash aria-hidden />
              </Button>
            </li>
          ))}
          {d.levels.length < 10 && <li><AddButton onClick={() => set({ levels: [...d.levels, ''] })}>Add a level</AddButton></li>}
        </ol>
      )}

      <AnimatePresence initial={false}>
        {error && (
          <motion.p key={error} role="alert" className="mt-3 text-sm text-stop" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function ReviewStep({ d, set, label, editing, steps, onEdit }: {
  d: Draft
  set: (p: Partial<Draft>) => void
  label: string
  editing?: Signal
  steps: StepId[]
  onEdit: (s: StepId) => void
}) {
  const answers =
    d.type === 'yes_no' ? [['Yes', d.yes], ['No', d.no]] as const
    : d.type === 'choice' ? d.options.map((o) => [title(slug(o.key)), o.text] as const)
    : d.levels.map((l, i) => [String(i), l] as const)
  const first = d.type === 'score' ? `0 ${d.levels[0]?.split(':')[0] ?? ''}` : answers[0]?.[0]
  const tokens = estimateTokens(toSpec(d))

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card">
        <Row label="Signal" onEdit={steps.includes('signal') ? () => onEdit('signal') : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{label || title(d.name)}</span>
            <span className="inline-flex items-center gap-1 rounded-md border px-1.5 text-xs font-medium text-ink-2"><TypeIcon type={d.type} /> {typeLabel(d.type)}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{d.instructions}</p>
        </Row>
        <Row label="Answers" onEdit={() => onEdit('answers')}>
          <ul className="space-y-1.5 text-sm">
            {answers.map(([k, v]) => (
              <li key={k} className="flex gap-2">
                <span className="shrink-0 self-start rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">{k}</span>
                <span className="text-ink-2">{v || <span className="text-muted-foreground">No description</span>}</span>
              </li>
            ))}
          </ul>
        </Row>
      </section>

      <section aria-label="Preview">
        <p className="mb-2 text-sm text-muted-foreground">In results it looks like this</p>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed px-4 py-3">
          <span className="text-sm text-muted-foreground">{label || title(d.name)}</span>
          <span className="flex items-center gap-3">
            <span className="font-medium">{first}</span>
            <span className="flex w-20 items-center gap-1.5 text-xs text-muted-foreground tabular-nums"><Meter value={0.87} className="w-10" /> 87%</span>
          </span>
        </div>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <CaretDown size={12} weight="bold" className="-rotate-90 transition-transform duration-200 group-data-[state=open]:rotate-0" aria-hidden />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="mt-4 space-y-5 rounded-xl bg-muted/50 p-4">
            <div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <label id="th-label" htmlFor="th" className="font-medium">Flag for review when the AI is less sure than</label>
                <span className="font-semibold tabular-nums">{pct(d.threshold)}</span>
              </div>
              <Slider id="th" className="mt-3" min={0} max={1} step={0.05} value={[d.threshold]} onValueChange={([v]) => set({ threshold: v })} aria-labelledby="th-label" />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Size</dt><dd>About {num(tokens)} tokens per call</dd></div>
              <div><dt className="text-muted-foreground">Export column</dt><dd><code className="font-mono">{d.name}</code></dd></div>
              {editing && <div><dt className="text-muted-foreground">Version</dt><dd>{editing.version}, saving makes {editing.version + 1}</dd></div>}
            </dl>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function Row({ label, onEdit, children }: { label: string; onEdit?: () => void; children: ReactNode }) {
  return (
    <div className="flex gap-4 border-b px-4 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
        {children}
      </div>
      {onEdit && (
        <Button type="button" variant="ghost" size="sm" className="-mr-2 shrink-0 text-muted-foreground" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}>
          <PencilSimple aria-hidden /> Edit
        </Button>
      )}
    </div>
  )
}

export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted-foreground">Optional</span>}
      </label>
      {children}
      <AnimatePresence mode="popLayout" initial={false}>
        {error ? (
          <motion.p key="e" id={`${id}-hint`} className="text-sm text-stop" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {error}
          </motion.p>
        ) : (
          hint && <motion.p key="h" id={`${id}-hint`} className="text-sm text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>{hint}</motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

const AddButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <Button type="button" variant="ghost" size="sm" className="-ml-2 text-primary hover:text-primary" onClick={onClick}>
    <Plus size={14} weight="bold" aria-hidden /> {children}
  </Button>
)
