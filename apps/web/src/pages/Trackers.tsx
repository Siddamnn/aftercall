import { CaretRight, CheckSquare, DotsThree, GitBranch, Gauge, Intersect, ListBullets, MagnifyingGlass, PencilSimple, Plus, Power, Sparkle, Trash, UploadSimple, X } from '@phosphor-icons/react'
import { Loader } from '../loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from '../lib/toast'
import { checkOverlap, deactivateSignal, deactivateTracker, deleteSignal, deleteTracker, getOverlap, listTrackers, saveSignal, saveTracker, TEMPLATES, type Signal, type SignalType, type Tracker } from '../api'
import { dependentsOf, describe } from '../conditions'
import { AlteriaCta, AlteriaMark, AlteriaTrackersDialog } from '../alteria'
import { ConditionDialog, ImportDialog } from '../tracker-dialogs'
import { turnOff } from '../turn-off'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { num, plural, title } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { ConfirmDelete } from '../confirm-delete'
import { ErrorNote, PageHeader } from '../ui'
import { SignalWizard, type WizardMode } from '../wizard'

export const NEW = '_new' // slug() never starts a name with "_", so it can't collide

const ICON: Record<SignalType, typeof Gauge> = { yes_no: CheckSquare, choice: ListBullets, score: Gauge }

const OPEN_KEY = 'trackers-open'
const readOpen = (): string[] | null => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null')
  } catch {
    return null
  }
}

export default function Trackers() {
  const { tracker, signal } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload: reloadTrackers } = useLoad(listTrackers, [])
  // Which pairs of trackers haven't been checked for overlap. Optional: hidden if it fails.
  const overlap = useLoad(getOverlap, [])
  const reloadOverlap = overlap.reload
  const reload = () => {
    reloadTrackers()
    reloadOverlap()
  }

  // Switches flip at once; the list catches up when the save comes back.
  const [local, setLocal] = useState<Tracker[]>()
  const [prev, setPrev] = useState(data)
  if (data !== prev) {
    setPrev(data)
    setLocal(data)
  }
  const list = local ?? []
  const patch = (name: string, fn: (t: Tracker) => Tracker) => setLocal((ts) => ts?.map((t) => (t.name === name ? fn(t) : t)))

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string[] | null>(readOpen)
  const expanded = (name: string) => (open ?? list.slice(0, 1).map((t) => t.name)).includes(name)
  const toggle = (name: string) => {
    const now = open ?? list.slice(0, 1).map((t) => t.name)
    const nextOpen = now.includes(name) ? now.filter((n) => n !== name) : [...now, name]
    setOpen(nextOpen)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(nextOpen))
    } catch {
      // Not remembered; fine.
    }
  }

  // The wizard is driven by the URL, so ⌘K and links can open it.
  const mode: WizardMode | undefined =
    tracker === NEW ? { kind: 'new-tracker' }
    : tracker && signal === NEW ? { kind: 'new-signal', tracker }
    : tracker && signal ? (() => {
        const s = list.find((t) => t.name === tracker)?.signals.find((x) => x.name === signal)
        return s && { kind: 'edit' as const, tracker, signal: s }
      })()
    : undefined
  const [lastMode, setLastMode] = useState(mode)
  if (mode && JSON.stringify(mode) !== JSON.stringify(lastMode)) setLastMode(mode)
  const wizardOpen = !!mode && !!data

  const q = query.trim().toLowerCase()
  const matches = (s: Signal) => !q || `${title(s.name)} ${s.spec.instructions}`.toLowerCase().includes(q)
  const shown = list
    .map((t) => ({ t, signals: t.signals.filter(matches), hit: !q || title(t.name).toLowerCase().includes(q) }))
    .filter((x) => x.hit || x.signals.length)
    .sort((a, b) => Number(b.t.active) - Number(a.t.active))

  // Every PUT sends the tracker's condition back: leaving it out would remove it.
  const specOf = (t: Tracker, description = t.description) => ({ name: t.name, description, run_if: t.run_if })
  const activeDependents = (name: string, signal?: string) =>
    dependentsOf(name, list, signal).filter((d) => list.find((x) => x.name === d)?.active)

  const setTrackerOn = async (t: Tracker, on: boolean) => {
    patch(t.name, (x) => ({ ...x, active: on }))
    if (!on) {
      return turnOff({
        label: title(t.name),
        off: (force) => deactivateTracker(t.name, force),
        undo: () => saveTracker(specOf(t), false),
        description: "It won't run on new calls. Past results are kept.",
        dependents: activeDependents(t.name),
        done: reload,
      })
    }
    try {
      await saveTracker(specOf(t), false)
      toast.success(`${title(t.name)} is on`)
    } catch (e) {
      toast.error(`Couldn't turn on ${title(t.name)}`, { description: (e as Error).message })
    }
    reload()
  }

  const setSignalOn = async (t: Tracker, s: Signal, on: boolean) => {
    patch(t.name, (x) => ({ ...x, signals: x.signals.map((y) => (y.name === s.name ? { ...y, active: on } : y)) }))
    if (!on) {
      return turnOff({
        label: title(s.name),
        off: (force) => deactivateSignal(t.name, s.name, force),
        undo: () => saveSignal(t.name, s.spec, false),
        description: "New calls won't check it. Past results are kept.",
        dependents: activeDependents(t.name, s.name),
        done: reload,
      })
    }
    try {
      await saveSignal(t.name, s.spec, false)
      toast.success(`${title(s.name)} is on`)
    } catch (e) {
      toast.error(`Couldn't turn on ${title(s.name)}`, { description: (e as Error).message })
    }
    reload()
  }

  const saveDescription = async (t: Tracker, description: string) => {
    if (description === (t.description ?? '')) return
    patch(t.name, (x) => ({ ...x, description }))
    try {
      await saveTracker(specOf(t, description || null), false)
      toast.success('Description saved')
    } catch (e) {
      toast.error("Couldn't save the description", { description: (e as Error).message })
    }
    reload()
  }

  const [conditionFor, setConditionFor] = useState<Tracker>()
  const [importing, setImporting] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [checking, setChecking] = useState(false)
  const runOverlapCheck = async () => {
    setChecking(true)
    try {
      const r = await checkOverlap()
      const found = r.pairs.filter((p) => p.overlaps).length
      toast.success(found ? `${plural(found, 'pair')} of trackers overlap` : 'No trackers overlap', {
        description: found ? 'Trackers that overlap share a colour. A call can match both, so check they ask different things.' : 'Each tracker covers something different. The check is free.',
      })
    } catch (e) {
      toast.error("Couldn't check for overlap", { description: (e as Error).message })
    } finally {
      setChecking(false)
      reload()
    }
  }
  const unchecked = overlap.data?.unchecked.length ?? 0

  // What's waiting for the delete confirmation.
  const [deleting, setDeleting] = useState<{ t: Tracker; s?: Signal }>()
  const [lastDeleting, setLastDeleting] = useState(deleting)
  if (deleting && deleting !== lastDeleting) setLastDeleting(deleting)
  const del = deleting ?? lastDeleting // keeps the text while the dialog closes
  const blockers = del ? dependentsOf(del.t.name, list, del.s?.name).filter((d) => d !== del.t.name) : []
  const confirmDelete = async () => {
    const { t, s } = deleting!
    if (s) {
      await deleteSignal(t.name, s.name)
      patch(t.name, (x) => ({ ...x, signals: x.signals.filter((y) => y.name !== s.name) }))
      toast.success(`Deleted ${title(s.name)}`)
    } else {
      await deleteTracker(t.name)
      setLocal((ts) => ts?.filter((x) => x.name !== t.name))
      toast.success(`Deleted ${title(t.name)}`)
    }
    reload()
  }

  const empty = data && data.length === 0

  return (
    <>
      <PageHeader
        title="Trackers"
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-10" aria-label="More tracker actions"><DotsThree size={18} weight="bold" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setImporting(true)}><UploadSimple aria-hidden /> Import trackers</DropdownMenuItem>
                {list.length > 1 && (
                  <DropdownMenuItem onSelect={runOverlapCheck} disabled={checking}><Intersect aria-hidden /> Check for overlap</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {!empty && (
              <Button variant="outline" size="lg" onClick={() => setDrafting(true)}><AlteriaMark className="text-primary" /> alteria</Button>
            )}
            {!empty && (
              <Button size="lg" asChild>
                <Link to={`/trackers/${NEW}`}><Plus size={16} weight="bold" aria-hidden /> New tracker</Link>
              </Button>
            )}
          </>
        }
      >
        What you want to know about every call. Each tracker holds signals, the things the AI listens for.
      </PageHeader>

      {error && <ErrorNote onRetry={reload} className="mb-6">Couldn't load your trackers. {error}</ErrorNote>}

      {loading && !data ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading trackers">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[4.5rem] rounded-xl" />)}
        </div>
      ) : empty ? (
        <Welcome onDone={reload} onImport={() => setImporting(true)} onAlteria={() => setDrafting(true)} />
      ) : (
        <>
          <AnimatePresence initial={false}>
            {(unchecked > 0 || checking) && (
              <motion.div
                key="overlap"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.25, ease }}
                className="overflow-hidden"
              >
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed px-4 py-3 text-sm">
                  <Intersect size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 text-ink-2">
                    {checking ? <span className="shimmer-text font-medium">Checking which trackers overlap…</span>
                      : <>{unchecked === 1 ? '1 pair of trackers hasn\'t' : `${num(unchecked)} pairs of trackers haven't`} been checked for overlap yet.</>}
                  </span>
                  <Button variant="outline" size="sm" onClick={runOverlapCheck} disabled={checking}>
                    {checking && <Loader />} Check now <span className="font-normal text-muted-foreground">Free</span>
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {list.length > 1 && (
            <div className="relative mb-4 max-w-sm">
              <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a signal" aria-label="Find a signal" className="pr-8 pl-9" />
              {query && (
                <button onClick={() => setQuery('')} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Clear search">
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
          )}

          <motion.ul layout className="space-y-3">
            <AnimatePresence initial={false}>
              {shown.map(({ t, signals }) => (
                <motion.li key={t.name} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease }}>
                  <TrackerCard
                    t={t}
                    all={list}
                    signals={signals}
                    open={!!q || expanded(t.name)}
                    onToggle={() => toggle(t.name)}
                    onOn={(on) => setTrackerOn(t, on)}
                    onSignalOn={(s, on) => setSignalOn(t, s, on)}
                    onDescription={(d) => saveDescription(t, d)}
                    onDelete={() => setDeleting({ t })}
                    onSignalDelete={(s) => setDeleting({ t, s })}
                    onCondition={() => setConditionFor(t)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
          {q && shown.length === 0 && <p className="py-10 text-center text-ink-2">No signals match “{query}”.</p>}
        </>
      )}

      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={del?.s ? `Delete ${title(del.s.name)}?` : `Delete ${title(del?.t.name ?? '')}?`}
        onConfirm={confirmDelete}
        blocked={blockers.length > 0 && (
          <>{blockers.map(title).join(', ')} {blockers.length === 1 ? 'only runs' : 'only run'} when {del?.s ? title(del.s.name) : title(del?.t.name ?? '')}'s answer matches. Change or remove {blockers.length === 1 ? 'that condition' : 'those conditions'} first.</>
        )}
      >
        {del?.s
          ? <>It will no longer be checked on new calls, and you can reuse its name. Past results keep their answers. To pause it instead, turn it off.</>
          : <>This deletes the tracker{del?.t.signals.length ? <> and its {plural(del.t.signals.length, 'signal')}</> : null}. Past results keep their answers. To pause it instead, turn it off.</>}
      </ConfirmDelete>

      <ConditionDialog tracker={conditionFor} trackers={list} onClose={() => setConditionFor(undefined)} onSaved={reload} />
      <AlteriaTrackersDialog open={drafting} onOpenChange={setDrafting} existing={list.map((t) => t.name)} onImported={reload} />
      <ImportDialog open={importing} existing={list.map((t) => t.name)} onClose={() => setImporting(false)} onImported={reload} />

      <SignalWizard
        open={wizardOpen}
        mode={mode ?? lastMode}
        trackers={list}
        onClose={() => navigate('/trackers')}
        onSaved={(name) => {
          reload()
          setOpen((o) => (o && !o.includes(name) ? [...o, name] : o))
          navigate('/trackers')
        }}
      />
    </>
  )
}

function TrackerCard({ t, all, signals, open, onToggle, onOn, onSignalOn, onDescription, onDelete, onSignalDelete, onCondition }: {
  t: Tracker
  all: Tracker[]
  signals: Signal[]
  open: boolean
  onToggle: () => void
  onOn: (on: boolean) => void
  onSignalOn: (s: Signal, on: boolean) => void
  onDescription: (d: string) => void
  onDelete: () => void
  onSignalDelete: (s: Signal) => void
  onCondition: () => void
}) {
  const [editingDesc, setEditingDesc] = useState(false)
  const on = signals.filter((s) => s.active)
  const off = signals.filter((s) => !s.active)
  const bodyId = `tracker-${t.name}`

  return (
    <section
      className={cn('surface overflow-hidden transition-opacity duration-200', !t.active && 'opacity-60')}
      // Trackers that overlap share a colour, shown as a stripe down the left edge.
      style={t.color ? { boxShadow: `inset 3px 0 0 ${t.color}` } : undefined}
      aria-labelledby={`${bodyId}-h`}
    >
      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
        <button onClick={onToggle} aria-expanded={open} aria-controls={bodyId} className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={editingDesc}>
          <CaretRight size={14} weight="bold" className={cn('shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-90')} aria-hidden />
          <span className="min-w-0">
            <h2 id={`${bodyId}-h`} className="font-semibold">{title(t.name)}</h2>
            {!editingDesc && (
              <span className="block truncate text-sm text-muted-foreground">
                {open || !t.signals.length ? t.description || (t.active ? '' : 'Off') : t.signals.filter((s) => s.active).map((s) => title(s.name)).join(', ') || 'No signals yet'}
              </span>
            )}
            {!editingDesc && (t.run_if || t.overlaps_with.length > 0) && (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {t.run_if && (
                  <span className="inline-flex min-w-0 items-center gap-1 font-medium text-primary">
                    <GitBranch size={12} weight="bold" className="shrink-0" aria-hidden />
                    <span className="truncate">Only when {title(t.run_if.tracker)}: {describe(t.run_if, all)}</span>
                  </span>
                )}
                {t.overlaps_with.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: t.color ?? undefined }} aria-hidden />
                    Overlaps with {t.overlaps_with.map(title).join(', ')}
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
        {editingDesc && <DescriptionInput initial={t.description ?? ''} onDone={(d) => (setEditingDesc(false), d !== null && onDescription(d))} />}
        {!editingDesc && (
          <>
            <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:block">{plural(t.signals.filter((s) => s.active).length, 'signal')}</span>
            <Switch checked={t.active} onCheckedChange={onOn} aria-label={`${title(t.name)} runs on new calls`} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`More for ${title(t.name)}`}><DotsThree size={18} weight="bold" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild><Link to={`/trackers/${t.name}/${NEW}`}><Plus aria-hidden /> Add a signal</Link></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditingDesc(true)}><PencilSimple aria-hidden /> Edit description</DropdownMenuItem>
                <DropdownMenuItem onSelect={onCondition}><GitBranch aria-hidden /> {t.run_if ? 'Change condition' : 'Only run if…'}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onOn(!t.active)}><Power aria-hidden /> {t.active ? 'Turn off' : 'Turn on'}</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash aria-hidden /> Delete tracker</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { height: { duration: 0.3, ease }, opacity: { duration: 0.2, delay: 0.05 } } }}
            exit={{ height: 0, opacity: 0, transition: { height: { duration: 0.2, ease }, opacity: { duration: 0.1 } } }}
            className="overflow-hidden"
          >
            <ul className="border-t">
              {[...on, ...off].map((s) => (
                <SignalRow key={s.name} t={t} s={s} gates={all.filter((x) => x.run_if?.tracker === t.name && x.run_if.signal === s.name).map((x) => x.name)} onOn={(v) => onSignalOn(s, v)} onDelete={() => onSignalDelete(s)} />
              ))}
              <li>
                <Link to={`/trackers/${t.name}/${NEW}`} className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-primary transition-colors duration-150 hover:bg-muted/50 sm:px-5">
                  <span className="grid size-7 place-items-center rounded-lg border border-dashed border-primary/40"><Plus size={14} weight="bold" aria-hidden /></span>
                  {t.signals.length ? 'Add a signal' : 'Add the first signal. Until then this tracker has nothing to check.'}
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function SignalRow({ t, s, gates, onOn, onDelete }: { t: Tracker; s: Signal; gates: string[]; onOn: (on: boolean) => void; onDelete: () => void }) {
  const Icon = ICON[s.spec.type]
  return (
    <li className={cn('group flex items-center gap-3 border-b px-4 transition-colors duration-150 hover:bg-muted/50 sm:px-5', !s.active && 'text-muted-foreground')}>
      <Link to={`/trackers/${t.name}/${s.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-3">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', s.active ? 'bg-primary-soft text-primary' : 'bg-muted')}>
          <Icon size={15} weight="duotone" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-medium">
            {title(s.name)}
            {gates.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-1.5 text-xs font-medium text-primary">
                <GitBranch size={11} weight="bold" aria-hidden /> Decides if {gates.map(title).join(', ')} {gates.length === 1 ? 'runs' : 'run'}
              </span>
            )}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{s.spec.instructions}</span>
        </span>
      </Link>
      <Switch size="sm" checked={s.active} onCheckedChange={onOn} disabled={!t.active} aria-label={`Check ${title(s.name)} on new calls`} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Quiet until the row is hovered or focused; always there on touch screens. */}
          <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground transition-opacity duration-150 data-[state=open]:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100" aria-label={`More for ${title(s.name)}`}>
            <DotsThree size={18} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild><Link to={`/trackers/${t.name}/${s.name}`}><PencilSimple aria-hidden /> Edit</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash aria-hidden /> Delete signal</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function DescriptionInput({ initial, onDone }: { initial: string; onDone: (d: string | null) => void }) {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <Input
      ref={ref}
      value={v}
      maxLength={500}
      aria-label="Description"
      placeholder="What's this tracker for?"
      className="h-8 flex-1"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim())
        if (e.key === 'Escape') {
          e.preventDefault()
          onDone(null)
        }
      }}
    />
  )
}

/** First run: pick ready-made trackers or start from scratch. */
function Welcome({ onDone, onImport, onAlteria }: { onDone: () => void; onImport: () => void; onAlteria: () => void }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string>()
  const add = async (t: (typeof TEMPLATES)[number]) => {
    setBusy(t.name)
    await saveTracker({ name: t.name, description: t.description }, true)
    for (const s of t.signals) await saveSignal(t.name, s, true)
    toast.success(`Added ${title(t.name)}`, { description: 'Next: analyse some calls with it.', action: { label: 'Analyse calls', onClick: () => navigate('/analyse') } })
    setBusy(undefined)
    onDone()
  }
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className="surface overflow-hidden">
      <div className="relative isolate border-b px-6 py-10 text-center sm:px-10">
        <div className="dot-grid absolute inset-0 -z-10" aria-hidden />
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Sparkle size={22} weight="fill" aria-hidden /></span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">What do you want to track?</h2>
        <p className="mx-auto mt-2 max-w-[52ch] text-ink-2">
          Start with a ready-made tracker, or build your own. You can change everything later.
        </p>
      </div>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <AlteriaCta title="Describe it, and alteria drafts them" action="Draft with alteria" onClick={onAlteria}>
          Say what your conversations are and what you want to learn. You pick what to keep.
        </AlteriaCta>
      </div>
      <ul className="grid gap-3 p-4 sm:grid-cols-3 sm:p-6">
        {TEMPLATES.map((t, i) => (
          <motion.li key={t.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05, duration: 0.3, ease }}>
            <button
              onClick={() => add(t)}
              disabled={!!busy}
              className="flex h-full w-full flex-col rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow,transform] duration-150 hover:border-primary/50 hover:shadow-panel active:scale-[0.98] disabled:opacity-60"
            >
              <span className="font-semibold">{title(t.name)}</span>
              <span className="mt-0.5 text-sm text-ink-2">{t.description}</span>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {t.signals.map((s) => {
                  const Icon = ICON[s.type]
                  return <li key={s.name} className="flex items-center gap-1.5"><Icon size={14} aria-hidden /> {title(s.name)}</li>
                })}
              </ul>
              <span className="mt-auto pt-4 text-sm font-medium text-primary">{busy === t.name ? 'Adding…' : 'Use this'}</span>
            </button>
          </motion.li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-center gap-2 border-t px-6 py-4">
        <Button variant="outline" asChild><Link to={`/trackers/${NEW}`}><Plus weight="bold" aria-hidden /> Start from scratch</Link></Button>
        <Button variant="ghost" onClick={onImport}><UploadSimple aria-hidden /> Import: a file, pasted JSON, or another project</Button>
      </div>
    </motion.section>
  )
}
