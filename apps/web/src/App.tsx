import { BookOpenText, Buildings, SidebarSimple, ChartBar, Check, Coins, GearSix, MagnifyingGlass, Plus, PresentationChart, Pulse, SignOut, SquaresFour, Table, UploadSimple, UserCircle, UsersThree } from '@phosphor-icons/react'
import { BILLING_ON } from './config'
import { Avatar, useMe } from './people'
import { RouteProgress } from './loaders'
import { NotificationBell, useMarkSeenOnVisit } from './notifications'
import { useSidebar, SidebarHandle } from './sidebar'
import { UpgradeAfterLogin, UpgradeCard } from './upgrade'
import { useSignOut } from './session'
import { areaFor, can, type Area } from './access'
import { Forbidden } from './pages/Status'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { listTrackers, listUploads } from './api'
import { Mark, Wordmark } from './brand'
import { CommandMenu } from './command-menu'
import { useLoad } from './lib/hooks'
import { ease, rise } from './lib/motion'
import { cn } from './lib/utils'
import { useTheme } from './theme'
import { AlteriaMark } from './alteria'
import { useBilling } from './billing'
import { planOf, usd } from './plans'
import { useProjectId } from './project'
import { ProjectSwitcher, useProjects } from './projects'
import { ThemeButton } from './ui'
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { toasterProps } from './lib/toast'

/** The nav takes Phosphor-style icons; alteria's mark gets the same props. */
const AlteriaIcon = ({ size, className }: { size?: number; weight?: string; className?: string }) => <AlteriaMark size={size} className={className} />

// `need`: the role must have that area (access.ts), or the item is hidden.
const NAV: { to: string; label: string; Icon: typeof SquaresFour | typeof AlteriaIcon; badge?: string; phoneOnly?: boolean; need?: Area }[] = [
  { to: '/insights', label: 'Insights', Icon: SquaresFour },
  { to: '/ask', label: 'Ask alteria', Icon: AlteriaIcon, badge: BILLING_ON ? 'Pro' : undefined },
  { to: '/dashboards', label: 'Dashboards', Icon: PresentationChart },
  { to: '/trackers', label: 'Trackers', Icon: Pulse, need: 'trackers.edit' },
  { to: '/analyse', label: 'Analyse calls', Icon: UploadSimple, need: 'analyse' },
  { to: '/results', label: 'Results', Icon: Table },
  // On wide screens Settings (with Usage in it) is the account menu at the bottom of the sidebar.
  { to: '/settings', label: 'Settings', Icon: GearSix, phoneOnly: true },
]

export default function App() {
  const { pathname, search: query } = useLocation()
  const section = pathname.split('/')[1]
  const [search, setSearch] = useState(false)
  const theme = useTheme()
  const project = useProjectId()
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  // The sidebar can be dragged wider or narrower, or collapsed to an icon rail (sidebar.tsx). Ask
  // alteria has its own sidebar of chats, so there the nav is always the rail.
  const sidebar = useSidebar()
  useMarkSeenOnVisit(pathname + query)
  const rail = section === 'ask' || sidebar.collapsed
  const role = useMe().data
  const need = areaFor(pathname)
  const allowed = !need || can(role, need)

  return (
    <div
      className={cn('min-h-dvh md:grid md:grid-cols-[var(--sidebar)_1fr] print:block', !sidebar.dragging && 'md:transition-[grid-template-columns] md:duration-200 md:ease-(--ease-smooth-out)')}
      style={{ '--sidebar': `${rail ? 64 : sidebar.width}px` } as React.CSSProperties}
    >
      <aside className={cn('group/side sticky top-0 z-20 flex print:hidden flex-col gap-1 border-b bg-background/85 px-4 py-3 backdrop-blur-md md:h-dvh md:min-w-0 md:border-r md:border-b-0 md:py-5', rail ? 'md:items-center md:px-2' : 'md:px-3')}>
        <SidebarHandle sidebar={sidebar} locked={section === 'ask'} />
        <div className={cn('mb-1 flex items-center justify-between gap-2 md:mb-4', rail && 'md:justify-center')}>
          <Link to="/" className="min-w-0 rounded-lg px-2 py-1" aria-label="aftercall home">
            <Wordmark className={rail ? 'md:hidden' : undefined} />
            {rail && <Mark size={24} className="hidden md:block" />}
          </Link>
          <span className={cn('flex items-center gap-0.5', rail && 'md:hidden')}>
            <NotificationBell side="bottom" align="end" />
            <button onClick={() => setSearch(true)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:hidden" aria-label="Search">
              <MagnifyingGlass size={17} aria-hidden />
            </button>
            <span className="md:hidden"><ThemeButton /></span>
          </span>
        </div>
        <ProjectSwitcher className={cn('mb-2 md:mb-3', rail && 'md:hidden')} />
        {rail && (
          <RailTip label="Notifications">
            <span className="mb-1 hidden md:flex"><NotificationBell side="right" align="start" className="size-10" /></span>
          </RailTip>
        )}
        {rail && (
          <RailTip label="Search" hint="⌘K">
            <button onClick={() => setSearch(true)} className="mb-3 hidden size-10 place-items-center rounded-lg border bg-card text-muted-foreground shadow-panel transition-[color,transform] duration-150 hover:text-foreground active:scale-[0.97] md:grid" aria-label="Search">
              <MagnifyingGlass size={17} aria-hidden />
            </button>
          </RailTip>
        )}
        <button
          onClick={() => setSearch(true)}
          className={cn(rail && 'md:!hidden', 'mb-3 hidden h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground shadow-panel transition-[color,transform] duration-150 hover:text-foreground active:scale-[0.98] md:flex')}
        >
          <MagnifyingGlass size={15} aria-hidden /> Search
          <kbd className="ml-auto rounded border bg-muted px-1.5 font-sans text-[0.6875rem] leading-5">⌘K</kbd>
        </button>
        <nav aria-label="Main" className="-mx-1 flex gap-0.5 overflow-x-auto md:mx-0 md:flex-col">
          {NAV.filter((n) => !n.need || can(role, n.need)).map(({ to, label, Icon, badge, phoneOnly }) => (
            <RailTip key={to} label={label} hint={badge} off={!rail}>
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'relative isolate flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm font-medium transition-colors duration-150',
                  phoneOnly && 'md:hidden',
                  rail && 'md:size-10 md:justify-center md:p-0',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-lg border bg-card shadow-panel"
                      transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.15 }}
                    />
                  )}
                  <Icon size={17} weight={isActive ? 'fill' : 'regular'} className={isActive ? 'text-primary' : ''} aria-hidden />
                  <span className={rail ? 'md:sr-only' : undefined}>{label}</span>
                  {badge && !rail && <span className="ml-auto hidden rounded-md bg-primary-soft px-1.5 text-[0.625rem] leading-4 font-semibold text-primary md:inline">{badge}</span>}
                </>
              )}
            </NavLink>
            </RailTip>
          ))}
        </nav>
        {rail && (
          <div className="mt-auto hidden flex-col items-center gap-2 md:flex">
            {section !== 'ask' && (
              <RailTip label="Expand sidebar" hint="⌘B">
                <button onClick={sidebar.toggle} className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Expand sidebar">
                  <SidebarSimple size={17} aria-hidden />
                </button>
              </RailTip>
            )}
            <UpgradeCard rail />
            <AccountMenu rail />
            <ThemeButton align="start" />
          </div>
        )}
        <div className={cn('mt-auto hidden space-y-3', !rail && 'md:block')}>
          {can(role, 'analyse') && <GettingStarted pathname={pathname} project={project} />}
          <UpgradeCard />
          <div className="flex items-center justify-between gap-1">
            <AccountMenu />
            <ThemeButton align="start" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={sidebar.toggle} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Collapse sidebar">
                  <SidebarSimple size={17} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Collapse <span className="ml-1.5 text-muted-foreground">⌘B</span></TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
      <main className={cn('mx-auto w-full print:max-w-none print:p-0', rail ? 'min-w-0' : 'max-w-[1120px] px-4 py-8 md:px-10 md:py-12')}>
        <motion.div key={`${project}/${section}`} {...rise}>
          {allowed ? <Outlet /> : <Forbidden inline />}
        </motion.div>
      </main>
      <RouteProgress />
      <CommandMenu open={search} setOpen={setSearch} />
      <UpgradeAfterLogin />
      <Toaster {...toasterProps(dark)} />
    </div>
  )
}

/** The account block: the workspace, and you under it. Opens the way into Settings. */
function AccountMenu({ rail }: { rail?: boolean }) {
  const { account } = useProjects()
  const billing = useBilling().data
  const me = useMe().data
  const signOut = useSignOut()
  const role = me
  const workspace = account.data?.name ?? 'Your workspace'
  const plan = billing?.plan ?? account.data?.plan
  // The balance is the workspace's: only people who can see billing see it (access.ts).
  const line = billing?.enabled && can(role, 'billing.view') ? `${planOf(billing.plan).name} · ${usd(billing.balance)}` : plan ? planOf(plan).name : ' '
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn('flex min-w-0 items-center gap-2.5 rounded-lg text-left transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98]', rail ? 'size-10 justify-center' : 'flex-1 p-1')}
          aria-label={`${workspace}${me ? `, signed in as ${me.name}` : ''}`}
        >
          <span className="relative shrink-0">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>{workspace.trim()[0]?.toUpperCase()}</span>
            {me && <Avatar p={me} size={16} ring className="absolute -right-1 -bottom-1" />}
          </span>
          {!rail && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium">{workspace}</span>
              <span className="block truncate text-xs text-muted-foreground">{me?.name ?? line}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={rail ? 'right' : 'top'} align="start" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{workspace}</span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">{line}</span>
          {me && (
            <span className="mt-2 flex items-center gap-2 border-t pt-2">
              <Avatar p={me} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-sm">{me.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
              </span>
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/settings"><GearSix aria-hidden /> Settings</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/settings/workspace"><Buildings aria-hidden /> Workspace</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/settings/profile"><UserCircle aria-hidden /> Profile</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/settings/team"><UsersThree aria-hidden /> Team</Link></DropdownMenuItem>
        {BILLING_ON && can(role, 'billing.view') && <DropdownMenuItem asChild><Link to="/settings/credits"><Coins aria-hidden /> Plan and credits</Link></DropdownMenuItem>}
        {billing?.enabled && can(role, 'billing.manage') && <DropdownMenuItem asChild><Link to="/settings/credits/add"><Plus aria-hidden /> Add credits</Link></DropdownMenuItem>}
        {can(role, 'usage.self') && <DropdownMenuItem asChild><Link to="/settings/usage"><ChartBar aria-hidden /> Usage</Link></DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/docs"><BookOpenText aria-hidden /> Docs and help</Link></DropdownMenuItem>
        {me && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}><SignOut aria-hidden /> Sign out</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A label beside an icon-only rail item. Off when the nav shows its labels. The trigger is its
 *  own span: Radix's Slot would merge props into NavLink and break its function className. */
function RailTip({ label, hint, off, children }: { label: string; hint?: string; off?: boolean; children: React.ReactElement }) {
  if (off) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="flex shrink-0">{children}</span></TooltipTrigger>
      <TooltipContent side="right" className="hidden md:flex">
        {label}
        {hint && <span className="ml-1.5 text-muted-foreground">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const SEEN_RESULTS = 'seen-results'
const seenResults = () => {
  try {
    return !!localStorage.getItem(SEEN_RESULTS)
  } catch {
    return false
  }
}

/** First-run checklist. Disappears once all three are done. */
function GettingStarted({ pathname, project }: { pathname: string; project: string | null }) {
  const trackers = useLoad(listTrackers, [pathname, project])
  const uploads = useLoad(listUploads, [pathname, project])
  useEffect(() => {
    if (!pathname.startsWith('/results/')) return
    try {
      localStorage.setItem(SEEN_RESULTS, '1')
    } catch {
      // Not remembered; fine.
    }
  }, [pathname])
  if (!trackers.data || !uploads.data) return null
  const steps = [
    { label: 'Set up a tracker', to: '/trackers', done: trackers.data.some((t) => t.active && t.signals.some((s) => s.active)) },
    { label: 'Analyse some calls', to: '/analyse', done: uploads.data.length > 0 },
    { label: 'Review the results', to: '/results', done: seenResults() },
  ]
  const done = steps.filter((s) => s.done).length

  return (
    <AnimatePresence initial={false}>
      {done < steps.length && (
        <motion.section
          key="gs"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease }}
          className="rounded-xl border bg-card p-3 shadow-panel"
          aria-labelledby="gs-h"
        >
          <div className="flex items-baseline justify-between">
            <h2 id="gs-h" className="text-sm font-semibold">Getting started</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{done} of {steps.length}</span>
          </div>
          <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.span className="block h-full origin-left rounded-full bg-primary" initial={false} animate={{ scaleX: done / steps.length }} transition={{ duration: 0.4, ease }} />
          </span>
          <ol className="mt-2.5 space-y-0.5">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className={cn('flex items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors duration-150 hover:bg-muted', s.done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'font-medium')}>
                  <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border', s.done && 'border-ok bg-ok text-white')}>
                    {s.done && <Check size={10} weight="bold" aria-hidden />}
                  </span>
                  {s.label}
                  {s.done && <span className="sr-only">(done)</span>}
                </Link>
              </li>
            ))}
          </ol>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
