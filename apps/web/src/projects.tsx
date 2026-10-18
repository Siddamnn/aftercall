// Projects (B37): the switcher in the sidebar, the New project dialog, and the plan meter.
// A project is a whole workspace: its own trackers, conversations, insights and dashboards.
import { CaretUpDown, Check, FolderSimple, GearSix, Plus, Sparkle } from '@phosphor-icons/react'
import { Loader } from './loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from './lib/toast'
import {
  createProject, getAccount, importTrackers, importTrackersFrom, listProjects, listTrackersIn, TEMPLATES,
  type Account, type ApiError, type Project,
} from './api'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Textarea } from './components/ui/textarea'
import { num, plural, title } from './lib/format'
import { useLoad } from './lib/hooks'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { planOf } from './plans'
import { projectsChanged, remembered, switchProject, useProjectId, useProjectsVersion } from './project'

/** A project's colour: one of the chart categories, picked from its id so it never changes. */
const hueOf = (id: string) => `var(--series-${(([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0) % 8) + 1})`

export function ProjectMark({ p, className }: { p: Pick<Project, 'id' | 'name'>; className?: string }) {
  return (
    <span className={cn('grid size-6 shrink-0 place-items-center rounded-md text-[0.6875rem] font-semibold text-white', className)} style={{ background: hueOf(p.id) }} aria-hidden>
      {p.name.trim()[0]?.toUpperCase() ?? '·'}
    </span>
  )
}

export const atLimit = (a?: Account) => !!a && a.project_limit !== null && a.projects >= a.project_limit

/** The shared project list and account; reloads when projects change. */
export function useProjects() {
  const v = useProjectsVersion()
  const id = useProjectId()
  const projects = useLoad(listProjects, [v])
  const account = useLoad(getAccount, [v])
  const current = projects.data?.find((p) => p.id === id) ?? projects.data?.[0]
  return { projects, account, current }
}

// ── The switcher ───────────────────────────────────────────────────────────────

export function ProjectSwitcher({ className }: { className?: string }) {
  const { projects, account, current } = useProjects()
  const id = useProjectId()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [creating, setCreating] = useState(false)

  // The project remembered from last time was deleted since: fall back to the first. Only for
  // that one; a project just created isn't in the list until it reloads.
  useEffect(() => {
    if (id && id === remembered && projects.data && !projects.data.some((p) => p.id === id) && projects.data[0]) switchProject(projects.data[0].id)
  }, [id, projects.data])

  // Before the backend has /projects (B37) there's one implicit project: nothing to switch.
  if (projects.error && !projects.data) return null

  const open = (p: Project) => {
    switchProject(p.id)
    navigate(`/${pathname.split('/')[1] || 'insights'}`) // leave detail pages: an upload or dashboard belongs to the old project
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn('flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg border bg-card px-2 text-left shadow-panel transition-[color,transform] duration-150 hover:bg-muted/50 active:scale-[0.98]', className)}>
            {current ? <ProjectMark p={current} /> : <span className="skeleton size-6 rounded-md" />}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[0.6875rem] text-muted-foreground">Project</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={current?.id} className="block truncate text-sm font-medium" initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
                  {current?.name ?? 'Loading…'}
                </motion.span>
              </AnimatePresence>
            </span>
            <CaretUpDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            Projects
            {account.data && <PlanCount a={account.data} />}
          </DropdownMenuLabel>
          {projects.data?.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => open(p)} className="gap-2.5 py-2">
              <ProjectMark p={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{plural(p.counts.trackers, 'tracker')} · {plural(p.counts.conversations, 'conversation')}</span>
              </span>
              {p.id === current?.id && <Check size={14} weight="bold" className="text-primary" aria-label="Open now" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}><Plus aria-hidden /> New project</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/projects')}><GearSix aria-hidden /> Manage projects</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function PlanCount({ a }: { a: Account }) {
  return (
    <span className={cn('tabular-nums', atLimit(a) && 'text-warn')}>
      {a.project_limit === null ? `${num(a.projects)} · ${planOf(a.plan).name}` : `${a.projects} of ${a.project_limit} · ${planOf(a.plan).name}`}
    </span>
  )
}

/** "3 of 5 projects" with a thin bar; amber when full. */
export function PlanMeter({ a, className }: { a: Account; className?: string }) {
  if (a.project_limit === null) return <p className={cn('text-sm text-ink-2', className)}>{plural(a.projects, 'project')} · {planOf(a.plan).name}, no limit</p>
  const full = atLimit(a)
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{a.projects} of {a.project_limit} projects</span>
        <span className="text-muted-foreground">{planOf(a.plan).name}</span>
      </div>
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <motion.span className={cn('block h-full origin-left rounded-full', full ? 'bg-warn' : 'bg-primary')} initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, a.projects / a.project_limit) }} transition={{ duration: 0.5, ease }} />
      </span>
    </div>
  )
}

// ── New project ────────────────────────────────────────────────────────────────

type Start = 'empty' | 'copy' | 'sample'

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [opens, setOpens] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpens((n) => n + 1)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <NewProject key={opens} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function NewProject({ onClose }: { onClose: () => void }) {
  const { projects, account, current } = useProjects()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState<Start>('empty')
  const [from, setFrom] = useState<string>()
  const [picked, setPicked] = useState<Set<string>>()
  const [nameError, setNameError] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const withTrackers = projects.data?.filter((p) => p.counts.trackers > 0) ?? []
  const source = from ?? (withTrackers.some((p) => p.id === current?.id) ? current?.id : withTrackers[0]?.id)
  const sourceTrackers = useLoad(async () => (source ? (await listTrackersIn(source)).filter((t) => t.active) : []), [source])
  const chosen = picked ?? new Set(sourceTrackers.data?.map((t) => t.name))

  if (account.data && atLimit(account.data)) return <LimitReached a={account.data} onClose={onClose} />

  const checkName = () => {
    const n = name.trim()
    if (!n) return setNameError('Give the project a name, like "Support chats" or "Sales follow-ups".'), false
    if (projects.data?.some((p) => p.name.toLowerCase() === n.toLowerCase())) return setNameError(`You already have a project called ${n}. Pick another name.`), false
    setNameError(undefined)
    return true
  }

  const create = async () => {
    if (!checkName()) return
    if (start === 'copy' && !chosen.size) return setError('Pick at least one tracker to copy, or start with nothing.')
    setBusy(true)
    setError(undefined)
    let p: Project
    try {
      p = await createProject({ name: name.trim(), description: description.trim() || null })
    } catch (e) {
      const err = e as ApiError
      if (err.status === 409) setNameError(err.message)
      else setError(err.message)
      setBusy(false)
      return
    }
    projectsChanged()
    switchProject(p.id)
    let copied = 0
    let note: string | undefined
    try {
      if (start === 'copy' && source) copied = (await importTrackersFrom(source, [...chosen], { dryRun: false, onConflict: 'skip' })).created.length
      if (start === 'sample') copied = (await importTrackers(new File([JSON.stringify(TEMPLATES)], 'sample-trackers.json'), { dryRun: false, onConflict: 'skip' })).created.length
    } catch (e) {
      note = `The project is ready, but the trackers weren't copied: ${(e as Error).message}`
    }
    projectsChanged()
    onClose()
    navigate(copied ? '/analyse' : '/trackers')
    if (note) toast.warning(note)
    else toast.success(`${p.name} is ready`, { description: copied ? `${plural(copied, 'tracker')} added. Analyse some conversations next.` : 'Set up what you want to track first.' })
  }

  const starts: { value: Start; label: string; hint: string; disabled?: string }[] = [
    { value: 'empty', label: 'Nothing yet', hint: 'Set up trackers from scratch.' },
    { value: 'copy', label: 'Trackers from another project', hint: 'Reuse what you already track. Copies are independent.', disabled: withTrackers.length ? undefined : 'None of your projects has trackers yet.' },
    { value: 'sample', label: 'The sample trackers', hint: `${TEMPLATES.map((t) => title(t.name)).join(', ')}: a clinic booking line.` },
  ]

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold tracking-tight">New project</DialogTitle>
        <DialogDescription className="text-ink-2">
          A separate workspace for one use case, with its own trackers, conversations, insights and dashboards.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="proj-name">Name</Label>
            <span className="text-xs text-muted-foreground tabular-nums">{name.length}/60</span>
          </div>
          <Input id="proj-name" autoFocus value={name} maxLength={60} placeholder="e.g. Support chats"
            aria-invalid={!!nameError} aria-describedby={nameError ? 'proj-name-err' : undefined}
            onChange={(e) => { setName(e.target.value); if (nameError) setNameError(undefined) }}
            onBlur={() => name && checkName()} onKeyDown={(e) => e.key === 'Enter' && create()} />
          {nameError && <p id="proj-name-err" role="alert" className="text-sm text-stop">{nameError}</p>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="proj-desc">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <span className="text-xs text-muted-foreground tabular-nums">{description.length}/200</span>
          </div>
          <Textarea id="proj-desc" value={description} maxLength={200} rows={2} placeholder="What these conversations are, and what you want to learn" onChange={(e) => setDescription(e.target.value)} />
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Start with</legend>
          <div role="radiogroup" className="space-y-2">
            {starts.map((o) => {
              const on = start === o.value
              return (
                <div key={o.value} className={cn('rounded-xl border transition-colors', on ? 'border-primary bg-primary-soft/50 ring-1 ring-primary' : 'bg-card', o.disabled && 'opacity-50')}>
                  <button role="radio" aria-checked={on} disabled={!!o.disabled} onClick={() => setStart(o.value)} className="flex w-full items-start gap-3 p-3 text-left disabled:cursor-not-allowed">
                    <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', on && 'border-primary bg-primary')}>{on && <span className="size-1.5 rounded-full bg-primary-foreground" />}</span>
                    <span>
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-xs text-muted-foreground">{o.disabled ?? o.hint}</span>
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {on && o.value === 'copy' && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
                        <div className="space-y-3 px-3 pb-3 pl-10">
                          <Select value={source} onValueChange={(v) => { setFrom(v); setPicked(undefined) }}>
                            <SelectTrigger className="w-full bg-card" aria-label="Copy from"><SelectValue placeholder="Pick a project" /></SelectTrigger>
                            <SelectContent>{withTrackers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                          </Select>
                          {!sourceTrackers.data ? <div className="skeleton h-16 rounded-lg" /> : (
                            <ul className="space-y-1.5">
                              {sourceTrackers.data.map((t) => (
                                <li key={t.name}>
                                  <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={chosen.has(t.name)} onCheckedChange={(c) => { const n = new Set(chosen); if (c) n.add(t.name); else n.delete(t.name); setPicked(n) }} />
                                    {title(t.name)} <span className="text-xs text-muted-foreground">{plural(t.signals.filter((s) => s.active).length, 'signal')}</span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </fieldset>
        {account.data && <PlanMeter a={{ ...account.data, projects: account.data.projects + 1 }} className="rounded-lg bg-muted/60 p-3" />}
        {error && <p role="alert" className="text-sm text-stop">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={create} disabled={busy}>{busy && <Loader />}Create project</Button>
      </DialogFooter>
    </>
  )
}

function LimitReached({ a, onClose }: { a: Account; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold tracking-tight">You've used every project on {planOf(a.plan).name}</DialogTitle>
        <DialogDescription className="text-ink-2">
          {planOf(a.plan).name} includes {a.project_limit} projects. Delete one you no longer need{a.plan === 'payg' ? ', or start Pro for 25' : ''}.
        </DialogDescription>
      </DialogHeader>
      <PlanMeter a={a} className="rounded-lg bg-muted/60 p-3" />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button variant="outline" asChild onClick={onClose}><Link to="/projects"><FolderSimple aria-hidden /> Manage projects</Link></Button>
        <Button asChild onClick={onClose}><Link to="/pricing">See plans</Link></Button>
      </DialogFooter>
    </>
  )
}

export function PremiumCard({ a }: { a: Account }) {
  if (a.plan === 'pro') return null
  const pro = planOf('pro')
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkle size={14} weight="fill" className="text-primary" aria-hidden /> Start Pro</p>
      <p className="mt-1 text-sm text-ink-2">{pro.tagline}. {pro.projects} projects, tokens included every month, and alteria.</p>
      <Button asChild size="sm" variant="outline" className="mt-3"><Link to="/pricing">Compare plans</Link></Button>
    </div>
  )
}
