// In-app notifications (B52): the bell, its unread count, and the panel. One shared copy, checked
// every 45 s while the tab is visible (the backend can later push with SSE instead). Something new
// arriving also shows a toast. What gets emailed is set in Settings → Profile.
import { Bell, ChatsCircle, CheckCircle, Checks, Coins, Gauge, UserPlus, Warning, WarningCircle, type Icon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { flyToBell } from './lib/toast'
import { localNotes, markLocalRead, onLocalNotes, type LocalNote } from './notifications-local'
import { listNotifications, markNotificationsRead, type AppNotification, type NotificationKind } from './api'
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover'
import { Loader } from './loaders'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { Avatar, useMe } from './people'
import { can } from './access'
import type { Concern } from './lib/toast'

// ── The shared copy ────────────────────────────────────────────────────────────

let state: { items?: AppNotification[]; unread: number; error?: string } = { unread: 0 }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let seen: Set<string> | undefined

async function refresh(announce: (n: AppNotification) => void) {
  try {
    const page = await listNotifications()
    const fresh = seen ? page.items.filter((n) => !n.read && !seen!.has(n.id)) : []
    seen = new Set(page.items.map((n) => n.id))
    state = { items: page.items, unread: page.unread }
    fresh.slice(0, 2).forEach(announce)
  } catch (e) {
    state = { ...state, error: (e as Error).message }
  }
  emit()
}

const set = (fn: (s: typeof state) => typeof state) => ((state = fn(state)), emit())

function useNotifications() {
  const snap = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => state)
  const navigate = useNavigate()
  useEffect(() => {
    // Already in the bell, so when it times out it flies there without being kept twice.
    const announce = (n: AppNotification) =>
      toast(n.title, {
        description: n.body ?? undefined, action: n.href ? { label: 'Open', onClick: () => navigate(n.href!) } : undefined,
        onAutoClose: () => flyToBell(n.title, n.body ?? undefined, 'info', false, CONCERN_OF[n.kind]),
      })
    if (!state.items) void refresh(announce)
    const id = setInterval(() => document.visibilityState === 'visible' && void refresh(announce), 45_000)
    const onShow = () => document.visibilityState === 'visible' && void refresh(announce)
    document.addEventListener('visibilitychange', onShow)
    return () => (clearInterval(id), document.removeEventListener('visibilitychange', onShow))
  }, [navigate])
  return snap
}

/** Opening the page a notification is about counts as seeing it: unread notifications whose link
 *  is exactly this page (path and query, not just the section) are marked read. Used by App. */
export function useMarkSeenOnVisit(path: string) {
  const snap = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => state)
  useEffect(() => {
    const bare = path.split('?')[0]
    // A link with a query must match it too; one without matches the page whatever its query.
    const seen = (href: string) => href === path || (!href.includes('?') && href === bare)
    const ids = (snap.items ?? []).filter((x) => !x.read && x.href && seen(x.href)).map((x) => x.id)
    if (ids.length) void markRead(ids)
  }, [path, snap.items])
}

async function markRead(ids?: string[]) {
  const before = state
  set((s) => ({ ...s, items: s.items?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)), unread: ids ? Math.max(0, s.unread - (s.items?.filter((n) => ids.includes(n.id) && !n.read).length ?? 0)) : 0 }))
  try {
    const { unread } = await markNotificationsRead(ids)
    set((s) => ({ ...s, unread }))
  } catch (e) {
    state = before
    emit()
    toast.error((e as Error).message)
  }
}

// ── The bell ───────────────────────────────────────────────────────────────────

const KIND: Record<NotificationKind, { Icon: Icon; tone: string }> = {
  run_finished: { Icon: CheckCircle, tone: 'text-ok' },
  run_failed: { Icon: WarningCircle, tone: 'text-stop' },
  low_balance: { Icon: Coins, tone: 'text-warn' },
  credits_added: { Icon: Coins, tone: 'text-ok' },
  plan_renewing: { Icon: Coins, tone: 'text-muted-foreground' },
  chat_shared: { Icon: ChatsCircle, tone: 'text-primary' },
  invite_accepted: { Icon: UserPlus, tone: 'text-primary' },
  member_joined: { Icon: UserPlus, tone: 'text-primary' },
  role_changed: { Icon: UserPlus, tone: 'text-muted-foreground' },
  alert: { Icon: Warning, tone: 'text-warn' },
  allowance_warning: { Icon: Gauge, tone: 'text-warn' },
  allowance_reached: { Icon: Gauge, tone: 'text-stop' },
}

// ── Concerns: the tabs in the panel ────────────────────────────────────────────

const TAB_KEY = 'bell-tab'

type Tab = 'all' | Concern
const CONCERN_OF: Record<NotificationKind, Concern> = {
  run_finished: 'runs', run_failed: 'runs',
  chat_shared: 'team', invite_accepted: 'team', member_joined: 'team', role_changed: 'team',
  low_balance: 'billing', credits_added: 'billing', plan_renewing: 'billing',
  allowance_warning: 'billing', allowance_reached: 'billing',
  alert: 'alerts',
}
const TABS: { id: Tab; label: string }[] = [
  // 'billing' holds credits and allowances, so it's called Usage.
  { id: 'all', label: 'All' }, { id: 'runs', label: 'Runs' }, { id: 'team', label: 'Team' }, { id: 'billing', label: 'Usage' }, { id: 'alerts', label: 'Alerts' },
]

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Toasts that flew into the bell this visit (lib/toast.ts). */
const useLocalNotes = () => useSyncExternalStore(onLocalNotes, localNotes)
const LOCAL_KIND: Record<LocalNote['kind'], { Icon: Icon; tone: string }> = {
  info: { Icon: Bell, tone: 'text-muted-foreground' }, success: { Icon: CheckCircle, tone: 'text-ok' },
  error: { Icon: WarningCircle, tone: 'text-stop' }, warning: { Icon: Warning, tone: 'text-warn' },
}

export function NotificationBell({ className, side = 'bottom', align = 'end' }: { className?: string; side?: 'bottom' | 'right' | 'top'; align?: 'start' | 'end' }) {
  const n = useNotifications()
  const local = useLocalNotes()
  // The badge counts toasts that timed out unseen too (lib/toast.ts).
  const unread = n.unread + local.filter((x) => !x.read).length
  const [open, setOpen] = useState(false)
  // A toast landing in the bell: a quick bump, so the eye follows it here.
  const [caught, setCaught] = useState(0)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => setCaught((c) => c + 1)
    el.addEventListener('bell-catch', on)
    return () => el.removeEventListener('bell-catch', on)
  }, [])
  // The tab you last looked at, for this visit.
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem(TAB_KEY) as Tab | null) ?? 'all'
    } catch {
      return 'all'
    }
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    try {
      sessionStorage.setItem(TAB_KEY, t)
    } catch {
      // Not remembered; fine.
    }
  }
  const me = useMe().data
  // Usage (credits, allowances) for people who see money, or who have an allowance notice of their own.
  const hasUsage = (n.items ?? []).some((x) => CONCERN_OF[x.kind] === 'billing')
  const tabs = TABS.filter((t) => t.id !== 'billing' || can(me, 'billing.view') || hasUsage)
  const inTab = (c: Concern) => tab === 'all' || c === tab
  const items = (n.items ?? []).filter((x) => inTab(CONCERN_OF[x.kind]))
  const localIn = local.filter((x) => inTab(x.concern))
  const unreadIn = (t: Tab) => (n.items ?? []).filter((x) => !x.read && (t === 'all' || CONCERN_OF[x.kind] === t)).length + local.filter((x) => !x.read && (t === 'all' || x.concern === t)).length
  const today = new Date().toDateString()
  const groups = [
    { label: 'Today', items: items.filter((x) => new Date(x.created_at).toDateString() === today) },
    { label: 'Earlier', items: items.filter((x) => new Date(x.created_at).toDateString() !== today) },
  ].filter((g) => g.items.length)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref} data-notification-bell
          className={cn('relative grid size-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.94]', className)}
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <motion.span key={`${unread}-${caught}`} animate={caught || unread ? { rotate: [0, -14, 10, -6, 0], scale: caught ? [1, 1.18, 1] : 1 } : undefined} transition={{ duration: 0.45, ease }} style={{ originY: 0.1 }} className="grid">
            <Bell size={17} weight={unread ? 'fill' : 'regular'} aria-hidden />
          </motion.span>
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                key="badge" className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground tabular-nums ring-2 ring-background"
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0, transition: { duration: 0.12 } }} transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.5 }}
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-4 pt-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <button onClick={() => (markLocalRead(), n.unread && void markRead())} disabled={!unread} className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">Mark all as read</button>
          </div>
          <div role="tablist" aria-label="Notifications by concern" className="-mx-1 mt-2 flex gap-0.5 overflow-x-auto">
            {tabs.map((t) => {
              const on = tab === t.id
              const count = unreadIn(t.id)
              return (
                <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)}
                  className={cn('relative flex shrink-0 items-center gap-1.5 px-2 pt-1 pb-2.5 text-[0.8125rem] font-medium transition-colors', on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {t.label}
                  {count > 0 && <span className={cn('rounded-full px-1.5 text-[0.625rem] leading-4 tabular-nums', on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{count}</span>}
                  {on && <motion.span layoutId="notes-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.15 }} />}
                </button>
              )
            })}
          </div>
        </div>
        <div className="max-h-[min(28rem,70dvh)] overflow-y-auto">
          {!n.items ? (
            <div className="grid h-32 place-items-center"><Loader size={18} label="Loading notifications" className="text-primary" /></div>
          ) : groups.length === 0 && localIn.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Checks size={28} className="mx-auto text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">{tab === 'all' ? 'Nothing yet' : `Nothing about ${tabs.find((t) => t.id === tab)?.label.toLowerCase()}`}</p>
              <p className="mt-0.5 text-sm text-ink-2">Finished runs, shared chats, alerts and credit warnings show up here.</p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h3 className="sticky top-0 z-10 bg-popover/95 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground backdrop-blur">{g.label}</h3>
                <ul className="px-1.5 pb-1.5">
                  <AnimatePresence initial={false}>
                    {g.items.map((x) => {
                      const { Icon, tone } = KIND[x.kind]
                      const body = (
                        <>
                          <span className="relative mt-0.5 shrink-0">
                            {x.actor ? <Avatar p={x.actor} size={28} /> : <span className="grid size-7 place-items-center rounded-full bg-muted"><Icon size={15} weight="fill" className={tone} aria-hidden /></span>}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block text-sm', !x.read && 'font-medium')}>{x.title}</span>
                            {x.body && <span className="block truncate text-xs text-ink-2">{x.body}</span>}
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="text-xs text-muted-foreground tabular-nums">{ago(x.created_at)}</span>
                            {!x.read && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                          </span>
                        </>
                      )
                      const cls = 'flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150 hover:bg-muted'
                      return (
                        <motion.li key={x.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                          {x.href
                            ? <Link to={x.href} className={cls} onClick={() => (setOpen(false), !x.read && void markRead([x.id]))}>{body}</Link>
                            : <button className={cls} onClick={() => !x.read && void markRead([x.id])}>{body}</button>}
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>
              </section>
            ))
          )}
          {n.items && localIn.length > 0 && (
            <section aria-label="Earlier this session">
              <h3 className="sticky top-0 z-10 bg-popover/95 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground backdrop-blur">Earlier this session</h3>
              <ul className="px-1.5 pb-1.5">
                <AnimatePresence initial={false}>
                  {localIn.map((x) => {
                    const { Icon, tone } = LOCAL_KIND[x.kind]
                    return (
                      <motion.li key={x.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} onClick={() => !x.read && markLocalRead([x.id])} className="flex cursor-default items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-muted">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted"><Icon size={14} weight="fill" className={tone} aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-sm', !x.read && 'font-medium')}>{x.title}</span>
                          {x.body && <span className="block truncate text-xs text-ink-2">{x.body}</span>}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="text-xs text-muted-foreground tabular-nums">{ago(x.at)}</span>
                          {!x.read && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                        </span>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </section>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5 text-sm">
          <Link to="/settings/profile" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">Email settings</Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
