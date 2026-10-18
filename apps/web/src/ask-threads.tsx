// Ask alteria's saved chats (B41): a sidebar per project with New chat, search, pinned chats, chats
// shared with the team (B43), and the rest grouped by day. Every row can be renamed in place,
// pinned, shared, exported or deleted, as far as the person's role allows. Select turns the list
// into checkboxes for bulk actions (B44). On phones the same list opens in a sheet.
import {
  ArrowSquareOut, Checks, CopySimple, DotsThree, DownloadSimple, FileMd, FilePdf, MagnifyingGlass, NotePencil, PencilSimple, PushPin, PushPinSlash, ShareNetwork, Trash, UsersThree, X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AskThreadSummary, ThreadBulkAction } from './api'
import { ConfirmDelete } from './confirm-delete'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { Avatar, canManageTeam, ProBadge, useFeature, useMe } from './people'
import { can as allowed } from './access'

export interface ThreadActions {
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onDelete: (id: string) => Promise<void>
  /** Opens the share dialog (or the Pro dialog). */
  onShare: (t: AskThreadSummary) => void
  onExport: (t: AskThreadSummary, as: 'md' | 'pdf') => void
  onCopy: (t: AskThreadSummary) => void
  /** Resolves with the ids that worked, so the selection keeps the ones that didn't. */
  onBulk: (ids: string[], action: ThreadBulkAction) => Promise<string[]>
  onBulkExport: (ids: string[]) => Promise<void>
}

/** What the signed-in person may do with a chat. The backend checks the same (B43). */
export function usePermissions() {
  const me = useMe().data
  const role = me?.role
  const admin = !role || canManageTeam(role)
  return {
    /** Asking spends credits: the `ask` permission (B54). Viewers have it, within their allowance. */
    cannotAsk: !allowed(me, 'ask'),
    viewer: role === 'viewer',
    canRename: (t: AskThreadSummary) => t.mine !== false,
    canShare: (t: AskThreadSummary) => t.mine !== false && !t.shared_at && role !== 'viewer',
    canDelete: (t: AskThreadSummary) => admin || (t.mine !== false && !t.shared_at),
  }
}

const DAY = 86_400_000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const SHARED = 'Shared with the team'

/** Pinned first, then the team's shared chats, then Today, Yesterday, Previous 7 days, 30 days, Older. */
function groups(threads: AskThreadSummary[]) {
  const today = startOfDay(new Date())
  const label = (t: AskThreadSummary) => {
    if (t.pinned) return 'Pinned'
    if (t.shared_at) return SHARED
    const at = Date.parse(t.updated_at)
    if (at >= today) return 'Today'
    if (at >= today - DAY) return 'Yesterday'
    if (at >= today - 7 * DAY) return 'Previous 7 days'
    if (at >= today - 30 * DAY) return 'Previous 30 days'
    return 'Older'
  }
  const order = ['Pinned', SHARED, 'Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']
  const out: { label: string; threads: AskThreadSummary[] }[] = []
  for (const t of threads) {
    const l = label(t)
    const g = out.find((x) => x.label === l)
    if (g) g.threads.push(t)
    else out.push({ label: l, threads: [t] })
  }
  return out.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
}

export function ThreadList({ threads, loading, error, activeId, query, onQuery, onNew, onPick, actions, className }: {
  threads?: AskThreadSummary[]
  loading: boolean
  error?: string
  activeId?: string
  query: string
  onQuery: (q: string) => void
  onNew: () => void
  /** Called after a row is followed, e.g. to close the phone sheet. */
  onPick?: () => void
  actions: ThreadActions
  className?: string
}) {
  const [deleting, setDeleting] = useState<AskThreadSummary>()
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const anchor = useRef<string>(undefined)
  const grouped = threads ? groups(threads) : []
  const order = grouped.flatMap((g) => g.threads.map((t) => t.id))

  const stopSelecting = () => (setSelecting(false), setPicked(new Set()))
  // Chats that left the list (deleted, or filtered out by search) aren't part of the selection.
  const live = threads ? new Set([...picked].filter((id) => threads.some((t) => t.id === id))) : picked

  const toggle = (id: string, range: boolean) => {
    setPicked((p) => {
      const next = new Set(p)
      if (range && anchor.current && order.includes(anchor.current)) {
        const [a, b] = [order.indexOf(anchor.current), order.indexOf(id)].sort((x, y) => x - y)
        const on = !p.has(id)
        for (const x of order.slice(a, b + 1)) {
          if (on) next.add(x)
          else next.delete(x)
        }
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <button
        onClick={onNew}
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm font-medium shadow-panel transition-[border-color,transform] duration-150 hover:border-primary/40 active:scale-[0.98]"
      >
        <NotePencil size={16} className="text-primary" aria-hidden /> New chat
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-[0.6875rem] leading-5 font-normal text-muted-foreground md:inline">⇧⌘O</kbd>
      </button>
      <div className="mt-2 flex shrink-0 items-center gap-1">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search chats</span>
          <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search chats"
            onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), onQuery(''))}
            className="h-8 w-full rounded-lg bg-muted/60 pr-7 pl-8 text-sm outline-none transition-[background-color,box-shadow] placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-primary/25"
          />
          {query && (
            <button onClick={() => onQuery('')} className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X size={11} weight="bold" aria-hidden />
            </button>
          )}
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              aria-pressed={selecting}
              disabled={!threads?.length}
              className={cn('grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-150 disabled:opacity-40', selecting ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
              aria-label={selecting ? 'Stop selecting' : 'Select chats'}
            >
              <Checks size={16} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{selecting ? 'Stop selecting' : 'Select chats'}</TooltipContent>
        </Tooltip>
      </div>

      <nav aria-label="Chats" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {error && !threads ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{error}</p>
        ) : !threads ? (
          <ul className="space-y-1.5 px-1 pt-5" aria-label="Loading chats">
            {[72, 88, 60, 80, 66].map((w, i) => <li key={i} className="skeleton h-5 rounded-md" style={{ width: `${w}%` }} />)}
          </ul>
        ) : threads.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {query ? <>No chats match “{query}”.</> : 'No chats yet. Everything you ask is saved here, in this project.'}
          </p>
        ) : (
          <motion.div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')} layout="position">
            {grouped.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h3 className="flex items-center gap-1 px-2.5 pb-1 text-[0.6875rem] font-medium text-muted-foreground">
                  {g.label === SHARED && <UsersThree size={12} aria-hidden />}{g.label}
                </h3>
                <ul>
                  <AnimatePresence initial={false}>
                    {g.threads.map((t) => (
                      <Row
                        key={t.id} t={t} active={t.id === activeId} onPick={onPick} actions={actions} onAskDelete={() => setDeleting(t)}
                        selecting={selecting} picked={live.has(t.id)} onToggle={(range) => toggle(t.id, range)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))}
          </motion.div>
        )}
      </nav>

      <AnimatePresence>
        {selecting && threads && (
          <BulkBar
            ids={[...live]} threads={threads} actions={actions}
            allPicked={live.size === threads.length}
            onAll={() => setPicked(live.size === threads.length ? new Set() : new Set(threads.map((t) => t.id)))}
            onDone={(done) => setPicked((p) => new Set([...p].filter((id) => !done.includes(id))))}
            onClose={stopSelecting}
          />
        )}
      </AnimatePresence>

      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={deleting?.shared_at ? 'Delete this chat for everyone?' : 'Delete this chat?'}
        onConfirm={() => actions.onDelete(deleting!.id)}
      >
        {deleting?.shared_at
          ? <>“{deleting.title}” is shared with the team. Deleting it removes it for everyone. Copies teammates made stay.</>
          : <>“{deleting?.title}” and its answers will be deleted. Dashboards you saved from it stay.</>}
      </ConfirmDelete>
    </div>
  )
}

function Row({ t, active, onPick, actions, onAskDelete, selecting, picked, onToggle }: {
  t: AskThreadSummary
  active: boolean
  onPick?: () => void
  actions: ThreadActions
  onAskDelete: () => void
  selecting: boolean
  picked: boolean
  onToggle: (range: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const can = usePermissions()
  const shareable = useFeature('share_chats')
  const sharer = t.shared_at && t.owner ? t.owner : undefined
  const label = (
    <>
      {sharer && <Avatar p={sharer} size={18} className="mr-2" />}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={t.title}
          className="block min-w-0 truncate"
          initial={{ opacity: 0, y: 3, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.2, ease }}
        >
          {t.title}
        </motion.span>
      </AnimatePresence>
    </>
  )
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease }}
      className="group/row relative isolate flex items-center rounded-lg"
    >
      {active && !selecting && (
        <motion.span layoutId="thread-pill" className="absolute inset-0 -z-10 rounded-lg border bg-card shadow-panel" transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.15 }} />
      )}
      {selecting ? (
        <button
          role="checkbox" aria-checked={picked}
          onClick={(e) => onToggle(e.shiftKey)}
          className={cn('flex min-w-0 flex-1 items-center rounded-lg py-1.5 pr-2 pl-2 text-left text-sm transition-colors duration-150', picked ? 'bg-primary-soft text-foreground' : 'text-ink-2 hover:bg-muted/60')}
        >
          <span className={cn('mr-2 grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-150', picked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')} aria-hidden>
            <AnimatePresence initial={false}>
              {picked && (
                <motion.svg viewBox="0 0 16 16" className="size-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                  <motion.path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18, ease }} />
                </motion.svg>
              )}
            </AnimatePresence>
          </span>
          {label}
        </button>
      ) : editing ? (
        <RenameInput
          title={t.title}
          onDone={(title) => {
            setEditing(false)
            if (title && title !== t.title) actions.onRename(t.id, title)
          }}
        />
      ) : (
        <Link
          to={`/ask/${t.id}`}
          onClick={onPick}
          onDoubleClick={(e) => can.canRename(t) && (e.preventDefault(), setEditing(true))}
          title={sharer ? `Shared by ${sharer.name}` : t.preview ?? t.title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center rounded-lg py-1.5 pr-8 pl-2.5 text-sm transition-colors duration-150',
            active ? 'font-medium text-foreground' : 'text-ink-2 hover:bg-muted/60 hover:text-foreground',
          )}
        >
          {label}
        </Link>
      )}
      {!editing && !selecting && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="absolute right-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              aria-label={`Options for ${t.title}`}
            >
              <DotsThree size={16} weight="bold" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <ThreadMenu t={t} align="start" onRename={() => setEditing(true)} onAskDelete={onAskDelete} actions={actions} shareable={shareable} />
        </DropdownMenu>
      )}
    </motion.li>
  )
}

/** The chat's menu, in the sidebar and in the chat's header: the same items in the same order. */
export function ThreadMenu({ t, align, onRename, onAskDelete, actions, shareable }: {
  t: AskThreadSummary
  align: 'start' | 'end'
  onRename?: () => void
  onAskDelete: () => void
  actions: ThreadActions
  shareable: boolean
}) {
  const can = usePermissions()
  return (
    <DropdownMenuContent align={align} className="w-52">
      {can.canRename(t) && onRename && <DropdownMenuItem onSelect={onRename}><PencilSimple aria-hidden /> Rename</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => actions.onPin(t.id, !t.pinned)}>
        {t.pinned ? <><PushPinSlash aria-hidden /> Unpin</> : <><PushPin aria-hidden /> Pin</>}
      </DropdownMenuItem>
      {can.canShare(t) && (
        <DropdownMenuItem onSelect={() => actions.onShare(t)}>
          <ShareNetwork aria-hidden /> Share with the team {!shareable && <ProBadge className="ml-auto" />}
        </DropdownMenuItem>
      )}
      {t.mine === false && <DropdownMenuItem onSelect={() => actions.onCopy(t)}><CopySimple aria-hidden /> Continue in a copy</DropdownMenuItem>}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><DownloadSimple aria-hidden /> Export</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-40">
          <DropdownMenuItem onSelect={() => actions.onExport(t, 'md')}><FileMd aria-hidden /> Markdown</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onExport(t, 'pdf')}><FilePdf aria-hidden /> PDF</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {t.copied_from && (
        <DropdownMenuItem asChild><Link to={`/ask/${t.copied_from.id}`}><ArrowSquareOut aria-hidden /> Open the original</Link></DropdownMenuItem>
      )}
      {can.canDelete(t) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onAskDelete}><Trash aria-hidden /> {t.shared_at ? 'Delete for everyone' : 'Delete'}</DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  )
}

/** Bulk actions on the selected chats. Delete and pin are on every plan; export and share are Pro. */
function BulkBar({ ids, threads, actions, allPicked, onAll, onDone, onClose }: {
  ids: string[]
  threads: AskThreadSummary[]
  actions: ThreadActions
  allPicked: boolean
  onAll: () => void
  onDone: (done: string[]) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const exportable = useFeature('bulk_export')
  const shareable = useFeature('share_chats')
  const can = usePermissions()
  const picked = threads.filter((t) => ids.includes(t.id))
  const anyUnpinned = picked.some((t) => !t.pinned)
  const deletable = picked.filter(can.canDelete).length
  const run = async (key: string, fn: () => Promise<string[] | void>) => {
    setBusy(key)
    try {
      const done = await fn()
      if (done) onDone(done)
    } finally {
      setBusy(undefined)
    }
  }
  const n = ids.length
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease }}
      className="-mx-1 mb-3 shrink-0 rounded-xl border bg-card p-2 shadow-float"
      role="toolbar" aria-label="Selected chats"
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <p className="text-sm font-medium tabular-nums" aria-live="polite">{n ? `${n} selected` : 'Select chats'}</p>
        <div className="flex items-center gap-1">
          <button onClick={onAll} className="rounded px-1.5 text-xs font-medium text-primary hover:underline">{allPicked ? 'None' : 'All'}</button>
          <button onClick={onClose} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Stop selecting"><X size={12} weight="bold" aria-hidden /></button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-0.5">
        <BulkButton busy={busy === 'pin'} disabled={!n || !!busy} label={anyUnpinned ? 'Pin' : 'Unpin'} icon={anyUnpinned ? <PushPin size={17} aria-hidden /> : <PushPinSlash size={17} aria-hidden />} onClick={() => run('pin', () => actions.onBulk(ids, anyUnpinned ? 'pin' : 'unpin'))} />
        <BulkButton busy={busy === 'export'} disabled={!n || !!busy} label="Export" icon={<DownloadSimple size={17} aria-hidden />} pro={!exportable} onClick={() => run('export', () => actions.onBulkExport(ids))} />
        <BulkButton busy={busy === 'share'} disabled={!n || !!busy || can.viewer || !picked.some(can.canShare)} label="Share" icon={<ShareNetwork size={17} aria-hidden />} pro={!shareable} onClick={() => run('share', () => actions.onBulk(ids, 'share'))} />
        <BulkButton busy={busy === 'delete'} disabled={!n || !!busy || !deletable} label="Delete" icon={<Trash size={17} aria-hidden />} danger onClick={() => setConfirm(true)} />
      </div>
      <ConfirmDelete
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${deletable === 1 ? 'this chat' : `${deletable} chats`}?`}
        onConfirm={() => run('delete', () => actions.onBulk(ids, 'delete'))}
      >
        {deletable < n ? `${n - deletable} of the selected can’t be deleted by you and will stay. ` : ''}
        {picked.some((t) => t.shared_at && can.canDelete(t)) ? 'Shared chats are deleted for everyone. ' : ''}
        Dashboards saved from them stay.
      </ConfirmDelete>
    </motion.div>
  )
}

function BulkButton({ label, icon, pro, onClick, disabled, busy, danger }: { label: string; icon: ReactNode; pro?: boolean; onClick: () => void; disabled: boolean; busy: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={cn('flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[0.6875rem] font-medium transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40', danger ? 'text-stop' : 'text-ink-2')}
    >
      <span className={cn('relative', busy && 'animate-pulse')}>
        {icon}
        {pro && <span className="absolute -top-1 -right-2.5 size-2 rounded-full bg-primary ring-2 ring-card" aria-label="Pro" />}
      </span>
      {label}
    </button>
  )
}

/** Enter or leaving the field saves; Escape keeps the old name. */
export function RenameInput({ title, onDone, className }: { title: string; onDone: (title: string | null) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v?.trim() || null)
  }
  // After the menu closes and hands focus back to its trigger.
  useEffect(() => {
    const id = setTimeout(() => ref.current?.select(), 0)
    return () => clearTimeout(id)
  }, [])
  return (
    <input
      ref={ref}
      defaultValue={title}
      maxLength={80}
      aria-label="Chat name"
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className={cn('h-8 min-w-0 flex-1 rounded-lg border border-primary/50 bg-card px-2.5 text-sm outline-none ring-2 ring-primary/20', className)}
    />
  )
}
