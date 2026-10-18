// /projects: every project in the account, the plan's limit, rename and delete.
import { ArrowRight, Check, DotsThree, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { Loader } from '../loaders'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '../lib/toast'
import { deleteProject, updateProject, USING_MOCK, type ApiError, type Project } from '../api'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { num, plural } from '../lib/format'
import { ease } from '../lib/motion'
import { projectsChanged, switchProject } from '../project'
import { atLimit, NewProjectDialog, PlanMeter, PremiumCard, ProjectMark, useProjects } from '../projects'
import { ErrorNote, PageHeader } from '../ui'

export default function Projects() {
  const { projects, account, current } = useProjects()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Project>()
  const [deleting, setDeleting] = useState<Project>()

  const open = (p: Project) => {
    switchProject(p.id)
    navigate('/insights')
  }

  return (
    <>
      <PageHeader title="Projects" actions={<Button onClick={() => setCreating(true)}><Plus aria-hidden /> New project</Button>}>
        Keep each use case apart. A project has its own trackers, conversations, insights and dashboards.
      </PageHeader>

      {projects.error && !projects.data ? (
        <ErrorNote onRetry={projects.reload}>
          {USING_MOCK ? projects.error : <>Projects couldn't load. Check that the API is running. <span className="text-muted-foreground">({projects.error})</span></>}
        </ErrorNote>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <ul className="grid content-start gap-3 sm:grid-cols-2" aria-busy={!projects.data}>
            {!projects.data ? [0, 1].map((i) => <li key={i} className="skeleton h-36 rounded-xl" />) : projects.data.map((p, i) => {
              const here = p.id === current?.id
              return (
                <motion.li key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: Math.min(i, 6) * 0.04 }}
                  className="surface flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <ProjectMark p={p} className="size-9 rounded-lg text-sm" />
                    <div className="min-w-0 flex-1">
                      <h2 className="flex items-center gap-2 font-semibold tracking-tight">
                        <span className="truncate">{p.name}</span>
                        {here && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-soft px-1.5 text-[0.6875rem] font-medium text-primary"><Check size={10} weight="bold" aria-hidden />Open</span>}
                      </h2>
                      <p className="line-clamp-2 text-sm text-ink-2">{p.description ?? <span className="text-muted-foreground">No description</span>}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 text-muted-foreground" aria-label={`More for ${p.name}`}><DotsThree weight="bold" aria-hidden /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(p)}><PencilSimple aria-hidden /> Rename</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" disabled={projects.data!.length === 1} onSelect={() => setDeleting(p)}><Trash aria-hidden /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    {([['Trackers', p.counts.trackers], ['Conversations', p.counts.conversations], ['Dashboards', p.counts.dashboards]] as const).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd className="font-medium tabular-nums">{num(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    Created {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {!here && <Button variant="outline" size="sm" onClick={() => open(p)}>Open <ArrowRight aria-hidden /></Button>}
                  </div>
                </motion.li>
              )
            })}
          </ul>

          <aside className="space-y-3">
            {account.data ? <PlanMeter a={account.data} className="surface p-4" /> : <div className="skeleton h-16 rounded-xl" />}
            {account.data && atLimit(account.data) && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink-2">You're using every project on your plan. Delete one to make room, or upgrade.</p>
            )}
            {account.data && <PremiumCard a={account.data} />}
          </aside>
        </div>
      )}

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <RenameDialog project={editing} onClose={() => setEditing(undefined)} />
      <DeleteDialog project={deleting} onClose={() => setDeleting(undefined)} />
    </>
  )
}

function RenameDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{project && <RenameBody key={project.id} project={project} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function RenameBody({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim()) return setError('Give the project a name.')
    setBusy(true)
    try {
      await updateProject(project.id, { name: name.trim(), description: description.trim() || null })
      projectsChanged()
      onClose()
    } catch (e) {
      setError((e as ApiError).message)
      setBusy(false)
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold tracking-tight">Rename project</DialogTitle>
        <DialogDescription className="sr-only">Change the project's name and description</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="rn-name">Name</Label>
          <Input id="rn-name" autoFocus value={name} maxLength={60} onChange={(e) => (setName(e.target.value), setError(undefined))} onKeyDown={(e) => e.key === 'Enter' && save()} aria-invalid={!!error} />
          {error && <p role="alert" className="text-sm text-stop">{error}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rn-desc">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea id="rn-desc" rows={2} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy && <Loader />}Save</Button>
      </DialogFooter>
    </>
  )
}

/** Deleting a project deletes everything in it, so it asks for the name. */
function DeleteDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { projects, current } = useProjects()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const match = !!project && typed.trim().toLowerCase() === project.name.toLowerCase()
  const run = async () => {
    if (!project || !match) return
    setBusy(true)
    try {
      // Deleting the open project: move to another one first.
      if (project.id === current?.id) switchProject(projects.data!.find((p) => p.id !== project.id)!.id)
      await deleteProject(project.id)
      projectsChanged()
      toast.success(`Deleted ${project.name}`)
      setTyped('')
      onClose()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && !busy && (setTyped(''), setError(undefined), onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Delete {project?.name}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            This deletes its {plural(project?.counts.trackers ?? 0, 'tracker')}, {plural(project?.counts.conversations ?? 0, 'conversation')} with their answers, and {plural(project?.counts.dashboards ?? 0, 'dashboard')}, for good. Tokens already used stay on your usage.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="del-name">Type <span className="font-semibold">{project?.name}</span> to confirm</Label>
          <Input id="del-name" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
        </div>
        {error && <p role="alert" className="text-sm text-stop">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button variant="destructive" onClick={run} disabled={!match || busy}>{busy && <Loader />}Delete project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
