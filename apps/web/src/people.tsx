// People (B42): the signed-in person, avatars, roles, and the Pro gates teams meet (B48).
import { Sparkle } from '@phosphor-icons/react'
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getMe, type ApiError, type Me, type Person, type PlanFeatures, type Role } from './api'
import { useBilling } from './billing'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './components/ui/alert-dialog'
import { Button } from './components/ui/button'
import { cn } from './lib/utils'

// ── The signed-in person, shared ───────────────────────────────────────────────

let state: { data?: Me; error?: string; status?: number } = {}
let pending: Promise<void> | undefined
const listeners = new Set<() => void>()

function load() {
  pending ??= getMe().then(
    (data) => void (state = { data }),
    (e: ApiError) => void (state = { ...state, error: e.message, status: e.status }),
  ).finally(() => {
    pending = undefined
    listeners.forEach((l) => l())
  })
  return pending
}
export const setMe = (data: Me) => {
  state = { data }
  listeners.forEach((l) => l())
}
/** After signing in or out: forget who was signed in, and ask again. */
export const reloadMe = () => {
  state = {}
  return load()
}

/** GET /me. Undefined while loading, or before the backend has sign-in (B42). */
export function useMe() {
  const snap = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => state)
  useEffect(() => {
    if (!state.data) void load()
  }, [])
  return snap
}

export const canManageTeam = (r?: Role) => r === 'owner' || r === 'admin'

export const ROLES: { id: Role; label: string; can: string }[] = [
  { id: 'owner', label: 'Owner', can: 'Everything, including billing and deleting the workspace' },
  { id: 'admin', label: 'Admin', can: 'Invite people, change roles, add credits, delete anything' },
  { id: 'member', label: 'Member', can: 'Analyse, build trackers and dashboards, ask alteria, share their chats' },
  { id: 'viewer', label: 'Viewer', can: 'Read Insights, dashboards and shared chats, and ask alteria within an allowance. Free seats' },
]
export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)!.label

// ── Plan gates (B48) ───────────────────────────────────────────────────────────

/** Whether the plan has a feature. Everything is open while billing is off, like alteria. */
export function useFeature(f: keyof PlanFeatures) {
  const b = useBilling().data
  if (!b) return true
  return b.features?.[f] ?? (!b.enabled || b.plan === 'pro')
}

export function ProBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded bg-primary-soft px-1 text-[0.6875rem] leading-4 font-medium text-primary', className)}>
      <Sparkle size={9} weight="fill" aria-hidden /> Pro
    </span>
  )
}

/** "This is part of Pro": said once, with the way to Pro, instead of a disabled button. */
export function ProDialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <span className="mb-1 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary"><Sparkle size={20} weight="fill" aria-hidden /></span>
          <AlertDialogTitle className="text-lg font-semibold tracking-tight">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-ink-2">{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <Button asChild onClick={() => onOpenChange(false)}><Link to="/pricing">See Pro</Link></Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Avatars ────────────────────────────────────────────────────────────────────

const HUES = [250, 160, 20, 300, 200, 80, 340, 120]
const hueOf = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

/** A photo when there is one, else initials on a colour that stays the same for that person. */
export function Avatar({ p, size = 24, ring, className }: { p: Person; size?: number; ring?: boolean; className?: string }) {
  const h = hueOf(p.id)
  return (
    <span
      title={p.name}
      className={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold select-none', ring && 'ring-2 ring-background', className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4), background: `oklch(0.9 0.06 ${h})`, color: `oklch(0.38 0.12 ${h})` }}
    >
      {p.avatar_url ? <img src={p.avatar_url} alt="" className="size-full object-cover" /> : <span aria-hidden>{initials(p.name)}</span>}
    </span>
  )
}

export function AvatarStack({ people, max = 4, size = 24 }: { people: Person[]; max?: number; size?: number }) {
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <span className="flex -space-x-1.5" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => <Avatar key={p.id} p={p} size={size} ring />)}
      {more > 0 && <span className="grid place-items-center rounded-full bg-muted text-[0.625rem] font-medium text-muted-foreground ring-2 ring-background" style={{ width: size, height: size }}>+{more}</span>}
    </span>
  )
}
