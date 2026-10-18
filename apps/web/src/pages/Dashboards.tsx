// Dashboards: the user's own pages of charts. /dashboards lists them; /dashboards/:id is one,
// with its saved view (time range and filters), a grid of charts, and exports.
import {
  ArrowLeft, ChartBar, Check, Copy, DotsSixVertical, DotsThree, DownloadSimple, FileCsv, FileImage, Link as LinkIcon, PencilSimple, Plus,
  PresentationChart, Printer, Sparkle, Table, Trash,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ProBadge, ProDialog, useFeature } from '../people'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from '../lib/toast'
import {
  createDashboard, deleteDashboard, getDashboard, getDimensions, getInsights, listDashboards, listTrackers, saveDashboard, USING_MOCK,
  type Dashboard, type Dimensions, type Tracker, type Widget,
} from '../api'
import { AlteriaMark } from '../alteria'
import { ConfirmDelete } from '../confirm-delete'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { tableOf, useWidgetData, WidgetBody, type DashCtx, type TableData } from '../dashboard/charts'
import { WidgetEditor } from '../dashboard/editor'
import { autoTitle, KINDS, newId, suggestions, templates, type Template } from '../dashboard/model'
import { DrillDown, type Drill } from '../drill-down'
import { fileSlug, saveCsv, savePng, type Cell } from '../lib/export'
import { plural } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { rangeLabel, rangeOf, ScopeBar, scopeOf, shiftBack } from '../scope'
import { EmptyState, ErrorNote, Mono, PageHeader } from '../ui'

export default function Dashboards() {
  const { id } = useParams()
  return id ? <DashboardView key={id} id={id} /> : <DashboardList />
}

const dashboardsError = (error: string) => USING_MOCK ? error : (
  <>Dashboards couldn't load. Check that the API is running, or run the UI with <Mono>VITE_API_MOCK=true</Mono>. <span className="text-muted-foreground">({error})</span></>
)

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── The list ───────────────────────────────────────────────────────────────────

function DashboardList() {
  const list = useLoad(listDashboards, [])
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Dashboard>()
  const navigate = useNavigate()

  const duplicate = async (d: Dashboard) => {
    const copy = await createDashboard({ name: `${d.name} (copy)`, description: d.description, params: d.params, widgets: d.widgets.map((w) => ({ ...w, id: newId() })) })
    navigate(`/dashboards/${copy.id}`)
  }

  return (
    <>
      <PageHeader title="Dashboards" actions={list.data && list.data.length > 0 && (
        <>
          <Button variant="outline" asChild><Link to={`/ask?q=${encodeURIComponent('Build me a dashboard for ')}`}><AlteriaMark className="text-primary" /> Build with alteria</Link></Button>
          <Button onClick={() => setCreating(true)}><Plus aria-hidden /> New dashboard</Button>
        </>
      )}>
        Your own pages of charts. Pick what to show, save the filters, then share or export.
      </PageHeader>

      {list.error && !list.data ? (
        <ErrorNote onRetry={list.reload}>{dashboardsError(list.error)}</ErrorNote>
      ) : !list.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-xl" />)}</div>
      ) : list.data.length === 0 ? (
        <EmptyState icon={<PresentationChart size={22} aria-hidden />} title="No dashboards yet" action={
          <span className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setCreating(true)}><Plus aria-hidden /> Create a dashboard</Button>
            <Button variant="outline" asChild><Link to={`/ask?q=${encodeURIComponent('Build me a dashboard for ')}`}><AlteriaMark className="text-primary" /> Describe it to alteria</Link></Button>
          </span>
        }>
          Put the charts you check every week on one page. Start from a template made from your trackers, or from blank.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((d, i) => (
            <motion.li key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: Math.min(i, 6) * 0.04 }} className="relative">
              <Link to={`/dashboards/${d.id}`} className="surface group flex h-full flex-col p-4 transition-[box-shadow,transform] duration-150 hover:shadow-float active:scale-[0.99]">
                <MiniGrid widgets={d.widgets} />
                <h2 className="mt-4 truncate pr-8 font-semibold tracking-tight group-hover:text-primary">{d.name}</h2>
                {d.description && <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{d.description}</p>}
                <p className="mt-auto pt-3 text-xs text-muted-foreground">{plural(d.widgets.length, 'chart')} · updated {ago(d.updated_at)}</p>
              </Link>
              <div className="absolute right-2 bottom-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`More for ${d.name}`}><DotsThree weight="bold" aria-hidden /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => duplicate(d)}><Copy aria-hidden /> Duplicate</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}><Trash aria-hidden /> Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      <NewDashboard open={creating} onOpenChange={setCreating} />
      <ConfirmDelete
        open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title={`Delete ${deleting?.name}?`}
        onConfirm={async () => {
          await deleteDashboard(deleting!.id)
          setDeleting(undefined)
          list.reload()
        }}
      >
        Its charts and saved view go for good. Your conversations and answers aren't touched.
      </ConfirmDelete>
    </>
  )
}

/** A thumbnail of the layout: each chart as a block in its width, with its icon. */
function MiniGrid({ widgets }: { widgets: Widget[] }) {
  if (!widgets.length) return <div className="grid h-20 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">Empty</div>
  return (
    <div className="grid h-20 grid-cols-3 content-start gap-1 overflow-hidden rounded-lg bg-muted/60 p-1.5" aria-hidden>
      {widgets.slice(0, 9).map((w) => {
        const K = KINDS[w.kind]
        return (
          <span key={w.id} className={cn('grid h-5 place-items-center rounded-[4px] bg-card text-muted-foreground', w.size === 2 && 'col-span-2', w.size === 3 && 'col-span-3')}>
            <K.Icon size={11} aria-hidden />
          </span>
        )
      })}
    </div>
  )
}

function NewDashboard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const trackers = useLoad(listTrackers, [open])
  const dims = useLoad(getDimensions, [open])
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [pick, setPick] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const list: Template[] = trackers.data ? templates(trackers.data, dims.data) : []
  const chosen = list.find((t) => t.id === pick) ?? list[0]

  const create = async () => {
    if (!chosen) return
    setBusy(true)
    setError(undefined)
    try {
      const d = await createDashboard({ name: name.trim() || (chosen.id === 'blank' ? 'Untitled dashboard' : chosen.name), description: null, params: 'range=30', widgets: chosen.widgets })
      onOpenChange(false)
      navigate(`/dashboards/${d.id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">New dashboard</DialogTitle>
          <DialogDescription className="text-ink-2">Templates are built from your own trackers. You can change every chart after.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dash-name">Name</Label>
          <Input id="dash-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen && chosen.id !== 'blank' ? chosen.name : 'e.g. Weekly overview'} maxLength={80}
            onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium">Start from</legend>
          {!trackers.data ? <div className="skeleton h-40 rounded-xl" /> : (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {list.map((t) => {
                const on = chosen?.id === t.id
                return (
                  <button key={t.id} role="radio" aria-checked={on} onClick={() => setPick(t.id)}
                    className={cn('flex flex-col rounded-xl border p-3 text-left transition-[border,background,transform] duration-150 active:scale-[0.98]', on ? 'border-primary bg-primary-soft/60 ring-1 ring-primary' : 'bg-card hover:border-foreground/20')}>
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      {t.name}
                      <span className={cn('grid size-4 place-items-center rounded-full border', on && 'border-primary bg-primary text-primary-foreground')}>{on && <Check size={9} weight="bold" aria-hidden />}</span>
                    </span>
                    <span className="mt-0.5 text-xs text-muted-foreground">{t.description}</span>
                    {t.widgets.length > 0 && <span className="mt-2 text-xs text-ink-2">{plural(t.widgets.length, 'chart')}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </fieldset>
        {error && <p role="alert" className="text-sm text-stop">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy || !chosen}>{busy ? 'Creating…' : 'Create dashboard'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── One dashboard ──────────────────────────────────────────────────────────────

type SaveState = 'saved' | 'saving' | 'error'

function DashboardView({ id }: { id: string }) {
  const navigate = useNavigate()
  const loaded = useLoad(() => getDashboard(id), [id])
  const trackers = useLoad(listTrackers, [])
  const dims = useLoad(getDimensions, [])
  const [dash, setDash] = useState<Dashboard>()
  const dashRef = useRef<Dashboard>(undefined)
  const [save, setSave] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Widget | 'new'>()
  const [drill, setDrill] = useState<Drill>()
  const [deleting, setDeleting] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const tables = useRef(new Map<string, () => TableData | null>())
  // A whole dashboard at once is a bulk export: Pro (B48). One chart's CSV stays on both plans.
  const bulk = useFeature('bulk_export')
  const [pro, setPro] = useState(false)

  // First load: take the dashboard, and its saved view unless the link carries one.
  if (loaded.data && !dash) {
    setDash(loaded.data)
    dashRef.current = loaded.data
  }
  useEffect(() => {
    if (loaded.data && !params.toString()) setParams(new URLSearchParams(loaded.data.params), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data])

  const scope = scopeOf(params)
  const key = JSON.stringify(scope)
  const previous = shiftBack(scope)
  const range = rangeOf(params)
  const insights = useLoad(() => getInsights(scope), [key])
  const prev = useLoad(() => (previous ? getInsights(previous) : Promise.resolve(undefined)), [key])

  /** Every change shows at once; saving waits for a pause, so a drag or quick edits send one request. */
  const persist = (next: Dashboard, now = false) => {
    setDash(next)
    dashRef.current = next
    setSave('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const d = dashRef.current!
      try {
        await saveDashboard(d.id, { name: d.name, description: d.description, params: d.params, widgets: d.widgets })
        setSave('saved')
      } catch (e) {
        setSave('error')
        toast.error(`Couldn't save: ${(e as Error).message}`)
      }
    }, now ? 0 : 500)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  if (loaded.error && !dash) {
    return (
      <>
        <BackLink />
        <PageHeader title="Dashboard" />
        <ErrorNote onRetry={loaded.reload}>{loaded.error === 'Dashboard not found' ? 'This dashboard was deleted, or the link is wrong.' : dashboardsError(loaded.error)}</ErrorNote>
      </>
    )
  }
  if (!dash) {
    return (
      <div aria-busy="true">
        <BackLink />
        <div className="skeleton mb-8 h-9 w-64 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-56 rounded-xl" />)}</div>
      </div>
    )
  }

  const ctx: DashCtx = { scope, insights: insights.data, prev: prev.data, trackers: trackers.data ?? [], range, onDrill: setDrill }
  const update = (fn: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const viewChanged = params.toString() !== dash.params
  const setWidgets = (widgets: Widget[], now?: boolean) => persist({ ...dashRef.current!, widgets }, now)
  const upsert = (w: Widget) => {
    const ws = dashRef.current!.widgets
    setWidgets(ws.some((x) => x.id === w.id) ? ws.map((x) => (x.id === w.id ? w : x)) : [...ws, w])
  }
  const remove = (w: Widget) => {
    const ws = dashRef.current!.widgets
    const at = ws.findIndex((x) => x.id === w.id)
    setWidgets(ws.filter((x) => x.id !== w.id))
    toast(`Removed ${w.title || autoTitle(w, ctx.trackers)}`, {
      action: { label: 'Undo', onClick: () => { const cur = dashRef.current!.widgets; setWidgets([...cur.slice(0, at), w, ...cur.slice(at)]) } },
    })
  }
  const move = (w: Widget, by: number) => {
    const ws = [...dashRef.current!.widgets]
    const i = ws.findIndex((x) => x.id === w.id)
    const j = Math.max(0, Math.min(ws.length - 1, i + by))
    ws.splice(j, 0, ...ws.splice(i, 1))
    setWidgets(ws)
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const exportCsv = () => {
    const rows: Cell[][] = [[dash.name], [`View: ${rangeLabel(range)}${scope.where?.length || scope.channel || scope.agent_version || Object.keys(scope.meta ?? {}).length ? ', filtered' : ''}`], []]
    for (const w of dash.widgets) {
      const t = tables.current.get(w.id)?.()
      if (!t) continue
      rows.push([w.title || autoTitle(w, ctx.trackers)], t.head, ...t.rows, [])
    }
    saveCsv(rows, `${fileSlug(dash.name)}-${stamp}.csv`)
  }

  return (
    <div ref={gridRef}>
      <ProDialog open={pro} onOpenChange={setPro} title="Exporting a whole dashboard is part of Pro">
        On pay as you go, download any one chart as CSV or PNG from its menu, or this dashboard as PNG or PDF. Pro exports every chart’s table in one file.
      </ProDialog>
      <BackLink />
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[62ch] basis-full sm:basis-auto sm:flex-1">
          <InlineEdit value={dash.name} onChange={(name) => name.trim() && persist({ ...dash, name: name.trim() })} label="Dashboard name"
            className="text-[1.75rem] leading-tight font-semibold tracking-tight" />
          <InlineEdit value={dash.description ?? ''} placeholder="Add a description" onChange={(d) => persist({ ...dash, description: d.trim() || null })} label="Description"
            className="mt-1 text-ink-2" />
        </div>
        <div className="flex items-center gap-2 print:hidden" data-export-ignore>
          <SaveBadge state={save} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><DownloadSimple aria-hidden /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={bulk ? exportCsv : () => setPro(true)} disabled={!dash.widgets.length}>
                <FileCsv aria-hidden />
                <span className="flex flex-col"><span className="flex items-center gap-1.5">Every chart as CSV {!bulk && <ProBadge />}</span><span className="text-xs text-muted-foreground">One table per chart, in order</span></span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={async () => gridRef.current && savePng(gridRef.current, `${fileSlug(dash.name)}-${stamp}.png`)}><FileImage aria-hidden /> Image (PNG)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTimeout(print, 50)}><Printer aria-hidden /> Print or save as PDF</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={async () => { await navigator.clipboard.writeText(location.href); toast.success('Link copied. It opens this dashboard with this view.') }}>
                <LinkIcon aria-hidden /> Copy link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => setEditing('new')}><Plus aria-hidden /> Add chart</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="More"><DotsThree weight="bold" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={async () => {
                const copy = await createDashboard({ name: `${dash.name} (copy)`, description: dash.description, params: dash.params, widgets: dash.widgets.map((w) => ({ ...w, id: newId() })) })
                navigate(`/dashboards/${copy.id}`)
              }}><Copy aria-hidden /> Duplicate dashboard</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}><Trash aria-hidden /> Delete dashboard</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ScopeBar
        range={range} dims={dims.data} params={params} trackers={trackers.data ?? []} update={update}
        extra={viewChanged && (
          <motion.span className="flex items-center gap-1 print:hidden" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease }}>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setParams(new URLSearchParams(dash.params), { replace: true })}>Reset</Button>
            <Button variant="outline" size="sm" onClick={() => { persist({ ...dash, params: params.toString() }, true); toast.success('This view is now the dashboard’s default.') }}>
              Save view
            </Button>
          </motion.span>
        )}
      />

      {insights.error && !insights.data && <ErrorNote className="mt-4" onRetry={insights.reload}>{insights.error}</ErrorNote>}

      {dash.widgets.length === 0 ? (
        <StartHere trackers={trackers.data ?? []} dims={dims.data} onAdd={(w) => upsert(w)} onBuild={() => setEditing('new')} />
      ) : (
        <Grid widgets={dash.widgets} onReorder={(ws) => { setDash({ ...dashRef.current!, widgets: ws }); dashRef.current = { ...dashRef.current!, widgets: ws } }} onDrop={() => setWidgets(dashRef.current!.widgets)}>
          {(w, grip) => (
            <WidgetCard
              w={w} ctx={ctx} grip={grip} dashName={dash.name}
              register={(fn) => { if (fn) tables.current.set(w.id, fn); else tables.current.delete(w.id) }}
              onEdit={() => setEditing(w)}
              onDuplicate={() => { const ws = dashRef.current!.widgets; const i = ws.findIndex((x) => x.id === w.id); setWidgets([...ws.slice(0, i + 1), { ...w, id: newId() }, ...ws.slice(i + 1)]) }}
              onSize={(size) => upsert({ ...w, size })}
              onMove={(by) => move(w, by)}
              onRemove={() => remove(w)}
            />
          )}
        </Grid>
      )}
      {dash.widgets.length > 0 && (
        <button onClick={() => setEditing('new')} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary-soft/40 hover:text-primary print:hidden" data-export-ignore>
          <Plus aria-hidden /> Add a chart
        </button>
      )}

      <WidgetEditor
        open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)} initial={editing === 'new' ? undefined : editing}
        ctx={ctx} dims={dims.data} existing={dash.widgets} onSave={upsert}
      />
      <DrillDown drill={drill} trackers={trackers.data ?? []} onClose={() => setDrill(undefined)} />
      <ConfirmDelete
        open={deleting} onOpenChange={setDeleting} title={`Delete ${dash.name}?`}
        onConfirm={async () => {
          clearTimeout(timer.current)
          await deleteDashboard(dash.id)
          navigate('/dashboards')
        }}
      >
        Its charts and saved view go for good. Your conversations and answers aren't touched.
      </ConfirmDelete>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/dashboards" className="mb-4 inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground print:hidden">
      <ArrowLeft size={14} aria-hidden /> Dashboards
    </Link>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  return (
    <span className="mr-1 hidden min-w-16 text-right text-xs text-muted-foreground sm:block" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state} className="inline-flex items-center gap-1" initial={{ opacity: 0, y: 3, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -3, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
          {state === 'saving' ? <span className="shimmer-text">Saving…</span> : state === 'error' ? <span className="text-stop">Not saved</span> : <><Check size={12} weight="bold" className="text-ok" aria-hidden /> Saved</>}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** Text that turns into an input on click; Enter or leaving saves, Escape cancels. */
function InlineEdit({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; className?: string }) {
  const [draft, setDraft] = useState<string>()
  if (draft !== undefined) {
    return (
      <input
        autoFocus aria-label={label} value={draft} maxLength={label === 'Description' ? 200 : 80} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setDraft(undefined) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(undefined)
        }}
        className={cn('-mx-1.5 block w-full rounded-md bg-card px-1.5 outline-none ring-2 ring-ring/40', className)}
      />
    )
  }
  return (
    <button onClick={() => setDraft(value)} className={cn('group -mx-1.5 flex max-w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-muted/70', !value && 'text-muted-foreground', className)} title={`Edit ${label.toLowerCase()}`}>
      <span className="truncate">{value || placeholder}</span>
      <PencilSimple size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 print:hidden" aria-hidden />
    </button>
  )
}

// ── The grid: drag a chart by its handle; the others slide out of the way ──────

function Grid({ widgets, onReorder, onDrop, children }: {
  widgets: Widget[]
  onReorder: (ws: Widget[]) => void
  onDrop: () => void
  children: (w: Widget, grip: ReactNode) => ReactNode
}) {
  const [armed, setArmed] = useState<string>()
  const [dragging, setDragging] = useState<string>()
  return (
    <ul className="mt-4 grid grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence initial={false}>
        {widgets.map((w, i) => (
          <motion.li
            key={w.id}
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: dragging === w.id ? 0.4 : 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease, delay: dragging ? 0 : Math.min(i, 6) * 0.03 }}
            className={cn('min-w-0', w.size === 2 && 'sm:col-span-2', w.size === 3 && 'sm:col-span-2 lg:col-span-3')}
            draggable={armed === w.id}
            onDragStartCapture={(e: React.DragEvent) => {
              e.dataTransfer.effectAllowed = 'move'
              setDragging(w.id)
            }}
            onDragOver={(e: React.DragEvent) => {
              if (!dragging) return
              e.preventDefault()
              if (dragging === w.id) return
              const from = widgets.findIndex((x) => x.id === dragging)
              const next = [...widgets]
              next.splice(i, 0, ...next.splice(from, 1))
              onReorder(next)
            }}
            onDragEnd={() => {
              setDragging(undefined)
              setArmed(undefined)
              onDrop()
            }}
          >
            {children(w, (
              <span
                onPointerDown={() => setArmed(w.id)} onPointerUp={() => !dragging && setArmed(undefined)}
                className="-ml-1.5 grid h-7 w-5 cursor-grab place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100 hover:bg-muted active:cursor-grabbing print:hidden"
                title="Drag to move" aria-hidden data-export-ignore
              >
                <DotsSixVertical size={16} weight="bold" />
              </span>
            ))}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function WidgetCard({ w, ctx, grip, dashName, register, onEdit, onDuplicate, onSize, onMove, onRemove }: {
  w: Widget
  ctx: DashCtx
  grip: ReactNode
  dashName: string
  register: (fn: (() => TableData | null) | null) => void
  onEdit: () => void
  onDuplicate: () => void
  onSize: (s: Widget['size']) => void
  onMove: (by: number) => void
  onRemove: () => void
}) {
  const d = useWidgetData(w, ctx)
  const [asTable, setAsTable] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const name = w.title || autoTitle(w, ctx.trackers)
  const table = () => tableOf(w, d, ctx)
  useEffect(() => {
    register(table)
    return () => register(null)
  })
  const K = KINDS[w.kind]

  return (
    <article ref={ref} className="surface group/card flex h-full flex-col p-4" aria-label={name}>
      <header className="mb-4 flex items-start gap-1">
        {grip}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold tracking-tight" title={name}>{name}</h3>
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><K.Icon size={12} aria-hidden /> {K.label}</p>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center print:hidden" data-export-ignore>
          {w.kind !== 'table' && (
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
              onClick={() => setAsTable((t) => !t)} aria-label={asTable ? 'Show as chart' : 'Show as table'} title={asTable ? 'Show as chart' : 'Show as table'}>
              {asTable ? <ChartBar aria-hidden /> : <Table aria-hidden />}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Chart options for ${name}`}><DotsThree weight="bold" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onEdit}><PencilSimple aria-hidden /> Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}><Copy aria-hidden /> Duplicate</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Width</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={String(w.size)} onValueChange={(v) => onSize(Number(v) as Widget['size'])}>
                    <DropdownMenuRadioItem value="1">Narrow</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="2">Medium</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="3">Full width</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => onMove(-1)}>Move earlier</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(1)}>Move later</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!d.ready} onSelect={() => { const t = table(); if (t) saveCsv([t.head, ...t.rows], `${fileSlug(dashName)}-${fileSlug(name)}.csv`) }}>
                <FileCsv aria-hidden /> Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!d.ready} onSelect={() => ref.current && savePng(ref.current, `${fileSlug(name)}.png`)}>
                <FileImage aria-hidden /> Download PNG
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}><Trash aria-hidden /> Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex-1">
        <WidgetBody w={w} d={d} ctx={ctx} asTable={asTable} />
      </div>
    </article>
  )
}

/** An empty dashboard offers the top suggestions as one-click cards. */
function StartHere({ trackers, dims, onAdd, onBuild }: { trackers: Tracker[]; dims?: Dimensions; onAdd: (w: Widget) => void; onBuild: () => void }) {
  const sugg = suggestions(trackers, dims).slice(0, 6)
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="surface mt-4 p-6" aria-labelledby="start-h">
      <h2 id="start-h" className="flex items-center gap-2 font-semibold tracking-tight"><Sparkle size={16} weight="fill" className="text-primary" aria-hidden /> Start with a few charts</h2>
      <p className="mt-1 text-sm text-ink-2">Suggested from your trackers. Add any with one click, then change them as you like.</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sugg.map(({ widget: w, why }) => {
          const K = KINDS[w.kind]
          return (
            <li key={w.id}>
              <button onClick={() => onAdd({ ...w, id: newId() })} className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-[border,background,transform] duration-150 hover:border-primary/40 hover:bg-primary-soft/40 active:scale-[0.98]">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border text-primary"><K.Icon size={18} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{autoTitle(w, trackers)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{why}</span>
                </span>
                <Plus size={16} className="shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      <Button variant="outline" className="mt-4" onClick={onBuild}>Build your own</Button>
    </motion.section>
  )
}
