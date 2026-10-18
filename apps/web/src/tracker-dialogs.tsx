// Dialogs from the Trackers page: a tracker's condition, and importing trackers from a file,
// pasted JSON, or another project.
import { ArrowSquareOut, FileArrowUp, FileText, Warning } from '@phosphor-icons/react'
import { Loader } from './loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from './lib/toast'
import { importTrackers, importTrackersFrom, listTrackersIn, saveTracker, type ApiError, type Condition, type ImportResult, type Tracker } from './api'
import { Checkbox } from './components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { PasteJson } from './json-input'
import { useLoad } from './lib/hooks'
import { useProjects } from './projects'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog'
import { ConditionPicker } from './condition-picker'
import { conditionError } from './conditions'
import { num, plural, title } from './lib/format'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { ErrorNote, Segmented } from './ui'

// ── Condition ──────────────────────────────────────────────────────────────────

export function ConditionDialog({ tracker, trackers, onClose, onSaved }: {
  tracker?: Tracker
  trackers: Tracker[]
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open={!!tracker} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {tracker && <ConditionBody key={tracker.name} tracker={tracker} trackers={trackers} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function ConditionBody({ tracker, trackers, onClose, onSaved }: { tracker: Tracker; trackers: Tracker[]; onClose: () => void; onSaved: () => void }) {
  const [cond, setCond] = useState<Condition | null>(tracker.run_if)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const invalid = conditionError(cond, tracker.name, trackers)
  const save = async () => {
    setTried(true)
    if (invalid) return
    setBusy(true)
    setFailure(undefined)
    try {
      await saveTracker({ name: tracker.name, description: tracker.description, run_if: cond }, false)
      toast.success(cond ? `${title(tracker.name)} now runs only when the condition holds` : `${title(tracker.name)} runs on every call again`)
      onSaved()
      onClose()
    } catch (e) {
      setFailure((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold tracking-tight">When does {title(tracker.name)} run?</DialogTitle>
        <DialogDescription className="text-ink-2">Run it on every call, or only when another tracker's answer matches. Calls it skips aren't charged for its signals.</DialogDescription>
      </DialogHeader>
      <ConditionPicker self={tracker.name} trackers={trackers} value={cond} onChange={setCond} showErrors={tried} />
      {failure && <ErrorNote>{failure}</ErrorNote>}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || JSON.stringify(cond) === JSON.stringify(tracker.run_if)}>
          {busy && <Loader />} Save
        </Button>
      </DialogFooter>
    </>
  )
}

// ── Import ─────────────────────────────────────────────────────────────────────

type Mode = 'skip' | 'update'

export function ImportDialog({ open, existing, onClose, onImported }: {
  open: boolean
  existing: string[]
  onClose: () => void
  onImported: () => void
}) {
  const [opens, setOpens] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpens((n) => n + 1)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <ImportBody key={opens} existing={existing} onClose={onClose} onImported={onImported} />
      </DialogContent>
    </Dialog>
  )
}

type Source = { kind: 'file'; file: File } | { kind: 'project'; project: string; name: string; trackers: string[] }
type How = 'file' | 'paste' | 'project'

function ImportBody({ existing, onClose, onImported }: { existing: string[]; onClose: () => void; onImported: () => void }) {
  const [how, setHow] = useState<How>('file')
  const [source, setSource] = useState<Source>()
  const [mode, setMode] = useState<Mode>('skip')
  const [preview, setPreview] = useState<ImportResult>()
  const [errors, setErrors] = useState<string[]>()
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [over, setOver] = useState(false)
  const file = source?.kind === 'file' ? source.file : undefined

  const send = (src: Source, m: Mode, dryRun: boolean) =>
    src.kind === 'file' ? importTrackers(src.file, { dryRun, onConflict: m }) : importTrackersFrom(src.project, src.trackers, { dryRun, onConflict: m })

  // Every source or choice change re-checks it (a dry run: nothing is saved).
  const check = async (src: Source, m: Mode) => {
    setSource(src)
    setMode(m)
    setChecking(true)
    setPreview(undefined)
    setErrors(undefined)
    try {
      setPreview(await send(src, m, true))
    } catch (e) {
      const err = e as ApiError
      setErrors(err.errors?.length ? err.errors : [err.message])
    } finally {
      setChecking(false)
    }
  }
  const checkFile = (f: File, m: Mode) => check({ kind: 'file', file: f }, m)

  const run = async () => {
    if (!source) return
    setImporting(true)
    try {
      const r = await send(source, mode, false)
      const n = r.created.length + r.updated.length
      toast.success(`Imported ${plural(n, 'tracker')}${source.kind === 'project' ? ` from ${source.name}` : ''}`, {
        description: r.overlap_error
          ? r.overlap_error
          : r.overlap && Object.values(r.overlap.trackers).some((t) => t.color)
            ? 'Some trackers overlap. They share a colour on this page.'
            : 'Checked for overlap: none found.',
      })
      onImported()
      onClose()
    } catch (e) {
      const err = e as ApiError
      setErrors(err.errors?.length ? err.errors : [err.message])
      setImporting(false)
    }
  }

  const clashes = preview ? [...preview.updated, ...preview.skipped] : []
  const count = preview ? preview.created.length + preview.updated.length : 0

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold tracking-tight">Import trackers</DialogTitle>
        <DialogDescription className="text-ink-2">
          Trackers and their signals, from a JSON file, pasted JSON, or another project. It's checked first, and nothing is saved until you import.
        </DialogDescription>
      </DialogHeader>

      <Segmented id="import-how" label="Import from" className="self-start" value={how}
        onChange={(h) => { setHow(h); setSource(undefined); setPreview(undefined); setErrors(undefined) }}
        options={[{ value: 'file', label: 'File' }, { value: 'paste', label: 'Paste JSON' }, { value: 'project', label: 'Another project' }]} />

      {how === 'paste' ? (
        <PasteJson kind="trackers" onUse={(f) => checkFile(f, mode)} busy={checking} action={preview && file ? 'Check again' : 'Check trackers'} />
      ) : how === 'project' ? (
        <FromProject onChange={(src) => (src ? check(src, mode) : (setSource(undefined), setPreview(undefined)))} />
      ) : (
      <>
      <label
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) checkFile(f, mode)
        }}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition-[border-color,background-color] duration-200 has-focus-visible:border-primary',
          over ? 'border-primary bg-primary-soft' : 'hover:border-muted-foreground/50',
        )}
      >
        <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && checkFile(e.target.files[0], mode)} />
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background text-primary">
          {file ? <FileText size={20} weight="duotone" aria-hidden /> : <FileArrowUp size={20} weight="duotone" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{file ? file.name : 'Choose a .json file'}</span>
          <span className="block text-sm text-muted-foreground">{file ? 'Click to pick another' : 'Or drop it here'}</span>
        </span>
      </label>
      <Link to="/docs/import-trackers" target="_blank" className="-mt-2 inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline">
        How to write the file, or make it with AI <ArrowSquareOut size={12} aria-hidden />
      </Link>
      </>
      )}

      {source && existing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink-2">Trackers you already have</span>
          <Segmented id="import-mode" label="Trackers you already have" value={mode} onChange={(m) => check(source, m)}
            options={[{ value: 'skip', label: 'Keep mine' }, { value: 'update', label: 'Replace from file' }]} />
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {checking ? (
          <motion.p key="c" className="shimmer-text text-sm font-medium" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Checking the file…</motion.p>
        ) : errors ? (
          <motion.div key="e" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
            <ErrorNote>
              <p className="font-medium">{errors.length === 1 ? 'One thing to fix' : `${errors.length} things to fix`} before importing</p>
              <ul className="mt-1.5 max-h-40 list-disc space-y-1 overflow-y-auto pl-4 text-ink-2">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </ErrorNote>
          </motion.div>
        ) : preview ? (
          <motion.div key="p" className="rounded-xl border px-4 py-3.5 text-sm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
            <ul className="space-y-1.5">
              {preview.created.length > 0 && <Line label="New">{preview.created.map(title).join(', ')}</Line>}
              {preview.updated.length > 0 && <Line label="Replaced">{preview.updated.map(title).join(', ')}</Line>}
              {preview.skipped.length > 0 && <Line label="Kept as is">{preview.skipped.map(title).join(', ')}</Line>}
            </ul>
            <p className="mt-2.5 border-t pt-2.5 text-muted-foreground">
              {[
                preview.signals_created && `${plural(preview.signals_created, 'new signal')}`,
                preview.signals_updated && `${plural(preview.signals_updated, 'changed signal')}`,
                preview.signals_unchanged && `${num(preview.signals_unchanged)} unchanged`,
              ].filter(Boolean).join(', ') || 'No signal changes'}
              . Then a free check for trackers that overlap.
            </p>
            {mode === 'update' && preview.updated.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-warn"><Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> Changed signals get a new version. Past results keep their answers.</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={importing}>Cancel</Button>
        <Button onClick={run} disabled={!preview || count === 0 || importing || checking}>
          {importing && <Loader />}
          {preview && count === 0 && clashes.length ? 'Nothing new to import' : `Import${count ? ` ${plural(count, 'tracker')}` : ''}`}
        </Button>
      </DialogFooter>
    </>
  )
}


/** Pick a project, then which of its trackers to copy (all by default). */
function FromProject({ onChange }: { onChange: (src: Source | undefined) => void }) {
  const { projects, current } = useProjects()
  const others = projects.data?.filter((p) => p.id !== current?.id && p.counts.trackers > 0) ?? []
  const [project, setProject] = useState<string>()
  const trackers = useLoad(async () => (project ? (await listTrackersIn(project)).filter((t) => t.active) : undefined), [project])
  const [picked, setPicked] = useState<Set<string>>()
  const chosen = picked ?? new Set(trackers.data?.map((t) => t.name))
  const name = others.find((p) => p.id === project)?.name ?? ''
  const emit = (set: Set<string>) => onChange(project && set.size ? { kind: 'project', project, name, trackers: [...set] } : undefined)
  // Check as soon as the trackers are in, and again on every tick: a dry run is cheap.
  useEffect(() => {
    if (trackers.data) emit(new Set(trackers.data.map((t) => t.name)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackers.data])

  if (projects.data && !others.length) {
    return <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">None of your other projects has trackers yet.</p>
  }
  return (
    <div className="space-y-3">
      <Select value={project} onValueChange={(v) => { setProject(v); setPicked(undefined); onChange(undefined) }}>
        <SelectTrigger className="w-full" aria-label="Copy from project"><SelectValue placeholder="Pick a project to copy from" /></SelectTrigger>
        <SelectContent>{others.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-muted-foreground">· {plural(p.counts.trackers, 'tracker')}</span></SelectItem>)}</SelectContent>
      </Select>
      {project && (!trackers.data ? <div className="skeleton h-20 rounded-lg" /> : (
        <fieldset className="rounded-xl border px-4 py-3">
          <legend className="px-1 text-xs text-muted-foreground">Trackers to copy</legend>
          <ul className="space-y-1.5">
            {trackers.data.map((t) => (
              <li key={t.name}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={chosen.has(t.name)} onCheckedChange={(c) => { const n = new Set(chosen); if (c) n.add(t.name); else n.delete(t.name); setPicked(n); emit(n) }} />
                  {title(t.name)} <span className="text-xs text-muted-foreground">{plural(t.signals.filter((s) => s.active).length, 'signal')}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">Copies are independent: changing them here won't change the other project.</p>
    </div>
  )
}

function Line({ label, children }: { label: string; children: string }) {
  return (
    <li className="grid grid-cols-[6.5rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </li>
  )
}
