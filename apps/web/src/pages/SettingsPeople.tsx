// Settings → Team and Profile (B42). Built against the mock: the backend has no people yet.
import { ArrowClockwise, CheckCircle, DotsThree, EnvelopeSimple, GoogleLogo, LinkSimple, PaperPlaneTilt, Sparkle, Trash, UserMinus, X } from '@phosphor-icons/react'
import { Loader } from '../loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from '../lib/toast'
import { getTeam, invite, removeMember, resendInvite, revokeInvite, setRole, updateMe, type ApiError, type Invite, type Me, type Member, type Role, type Team } from '../api'
import { ConfirmAction } from '../confirm-action'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Avatar, canManageTeam, ROLES, roleLabel, setMe, useMe } from '../people'
import { ErrorNote } from '../ui'

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const since = (iso: string | null) => {
  if (!iso) return 'Never'
  const h = (Date.now() - Date.parse(iso)) / 3_600_000
  if (h < 1) return 'Active now'
  if (h < 24) return `${Math.round(h)} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}
/** People who count toward the plan's limit. Viewers are free. */
const seats = (t: Team) => t.members.filter((m) => m.role !== 'viewer').length + t.invites.filter((i) => i.role !== 'viewer').length

// ── Team ───────────────────────────────────────────────────────────────────────

export function TeamTab() {
  const me = useMe().data
  const team = useLoad(getTeam, [])
  const [t, setT] = useState<Team>()
  const data = t ?? team.data
  const admin = canManageTeam(me?.role)
  const update = (fn: (t: Team) => Team) => setT(fn(structuredClone(data!)))

  if (team.error && !data) return <ErrorNote onRetry={team.reload}>Couldn’t load the team. {team.error}</ErrorNote>
  if (!data) return <div className="space-y-3"><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-64 rounded-xl" /></div>

  const used = seats(data)
  const full = data.limit !== null && used >= data.limit
  return (
    <div className="space-y-8">
      <section className="surface px-5 py-4" aria-labelledby="seats-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="seats-h" className="text-sm text-muted-foreground">People who can ask and analyse</h2>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
              {used}{data.limit !== null && <span className="text-base font-normal text-muted-foreground"> of {data.limit}</span>}
            </p>
          </div>
          <p className="max-w-sm text-sm text-ink-2">
            {data.limit === null ? 'No limit on your plan, and no fee per person.' : <>Pay as you go includes {data.limit}. <Link to="/pricing" className="font-medium text-primary hover:underline">Pro</Link> has no limit, and no fee per person.</>}
            {' '}Viewers are free.
          </p>
        </div>
        {data.limit !== null && (
          <div className="mt-3 flex gap-1" aria-hidden>
            {Array.from({ length: data.limit }, (_, i) => (
              <motion.span key={i} className={cn('h-1.5 flex-1 rounded-full', i < used ? (full ? 'bg-warn' : 'bg-primary') : 'bg-muted')} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.3, ease, delay: i * 0.05 }} style={{ originX: 0 }} />
            ))}
          </div>
        )}
      </section>

      {admin && <InviteForm full={full} onInvited={(inv) => update((x) => ({ ...x, invites: [inv, ...x.invites] }))} />}

      <section aria-labelledby="members-h">
        <h2 id="members-h" className="mb-2 text-sm font-medium text-muted-foreground">Members · {data.members.length}</h2>
        <ul className="surface divide-y">
          <AnimatePresence initial={false}>
            {data.members.map((m) => (
              <MemberRow
                key={m.id} m={m} me={me} admin={admin}
                onRole={(mm) => update((x) => ({ ...x, members: x.members.map((y) => (y.id === mm.id ? mm : y)) }))}
                onRemoved={() => update((x) => ({ ...x, members: x.members.filter((y) => y.id !== m.id) }))}
              />
            ))}
          </AnimatePresence>
        </ul>
      </section>

      {data.invites.length > 0 && (
        <section aria-labelledby="invites-h">
          <h2 id="invites-h" className="mb-2 text-sm font-medium text-muted-foreground">Invites · {data.invites.length}</h2>
          <ul className="surface divide-y">
            <AnimatePresence initial={false}>
              {data.invites.map((i) => (
                <InviteRow
                  key={i.id} i={i} admin={admin}
                  onResent={(ii) => update((x) => ({ ...x, invites: x.invites.map((y) => (y.id === ii.id ? ii : y)) }))}
                  onRevoked={() => update((x) => ({ ...x, invites: x.invites.filter((y) => y.id !== i.id) }))}
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      <section aria-labelledby="roles-h">
        <h2 id="roles-h" className="mb-2 text-sm font-medium text-muted-foreground">Roles</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.id} className="rounded-xl border px-4 py-3">
              <dt className="text-sm font-medium">{r.label}</dt>
              <dd className="mt-0.5 text-sm text-ink-2">{r.can}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

function RoleSelect({ value, onChange, disabled, label, className }: { value: Exclude<Role, 'owner'>; onChange: (r: Exclude<Role, 'owner'>) => void; disabled?: boolean; label: string; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Exclude<Role, 'owner'>)} disabled={disabled}>
      <SelectTrigger className={cn('h-9 w-28 bg-card', className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {ROLES.filter((r) => r.id !== 'owner').map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function InviteForm({ full, onInvited }: { full: boolean; onInvited: (i: Invite) => void }) {
  const [email, setEmail] = useState('')
  const [role, setR] = useState<Exclude<Role, 'owner'>>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; pro: boolean }>()
  const send = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const inv = await invite(email, role)
      onInvited(inv)
      setEmail('')
      await copyLink(inv.link)
      toast.success(`Invite ready for ${inv.email}`, { description: 'Share this link with them. It works for 7 days. Copy it again from the list below.' })
    } catch (e) {
      const err = e as ApiError
      setError({ text: err.message, pro: err.status === 402 })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="invite-h">
      <h2 id="invite-h" className="mb-2 text-sm font-medium text-muted-foreground">Invite someone</h2>
      <form onSubmit={(e) => (e.preventDefault(), send())} className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Email</span>
          <EnvelopeSimple size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="email" value={email} onChange={(e) => (setEmail(e.target.value), setError(undefined))} placeholder="name@company.com" className="h-9 bg-card pl-9" aria-invalid={!!error && !error.pro} />
        </label>
        <RoleSelect value={role} onChange={(r) => (setR(r), setError(undefined))} label="Role" />
        <Button type="submit" disabled={!email.trim() || busy}><PaperPlaneTilt aria-hidden /> {busy ? 'Creating…' : 'Create invite link'}</Button>
      </form>
      {full && !error && role !== 'viewer' && <p className="mt-2 text-sm text-muted-foreground">You’re at your plan’s limit. Invite them as a viewer, or start Pro for more.</p>}
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto', x: [0, -4, 4, -2, 0] }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.3, ease }}
            className="overflow-hidden"
          >
            <div role="alert" className={cn('mt-2 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-sm', error.pro ? 'bg-primary-soft' : 'bg-stop-soft text-stop')}>
              {error.pro && <Sparkle size={16} weight="fill" className="shrink-0 text-primary" aria-hidden />}
              <span className="min-w-0 flex-1 basis-60">{error.text}</span>
              {error.pro && <Button size="sm" asChild><Link to="/pricing">See Pro</Link></Button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

const rowMotion = {
  layout: 'position' as const,
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
  transition: { duration: 0.25, ease },
}

function MemberRow({ m, me, admin, onRole, onRemoved }: { m: Member; me?: Me; admin: boolean; onRole: (m: Member) => void; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false)
  const [saving, setSaving] = useState(false)
  const self = m.id === me?.id
  const editable = admin && m.role !== 'owner' && !self
  const change = async (role: Exclude<Role, 'owner'>) => {
    setSaving(true)
    try {
      onRole(await setRole(m.id, role))
      toast.success(`${m.name.split(' ')[0]} is now ${role === 'admin' ? 'an' : 'a'} ${roleLabel(role).toLowerCase()}`)
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <motion.li {...rowMotion} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar p={m} size={36} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">{m.name}{self && <span className="rounded bg-muted px-1.5 text-[0.6875rem] font-medium text-muted-foreground">You</span>}</p>
        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
      </div>
      <p className="hidden w-24 text-xs text-muted-foreground sm:block">{since(m.last_active_at)}</p>
      {editable ? (
        <RoleSelect value={m.role as Exclude<Role, 'owner'>} onChange={change} disabled={saving} label={`Role for ${m.name}`} />
      ) : (
        <span className="flex h-9 w-28 items-center px-3 text-sm text-ink-2">{roleLabel(m.role)}</span>
      )}
      <div className="w-8">
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Options for ${m.name}`}><DotsThree size={18} weight="bold" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}><UserMinus aria-hidden /> Remove from workspace</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ConfirmAction
        open={removing} onOpenChange={setRemoving} title={`Remove ${m.name}?`} action="Remove" destructive
        onConfirm={async () => (await removeMember(m.id), onRemoved(), toast.success(`${m.name} was removed`))}
      >
        They lose access at once. Chats they shared stay with the team, and their private chats are kept for 30 days in case they come back.
      </ConfirmAction>
    </motion.li>
  )
}

/** Copies to the clipboard; false when the browser refuses. */
const copyLink = (link: string) => navigator.clipboard.writeText(link).then(() => true, () => false)

function InviteRow({ i, admin, onResent, onRevoked }: { i: Invite; admin: boolean; onResent: (i: Invite) => void; onRevoked: () => void }) {
  const [busy, setBusy] = useState<'resend' | 'revoke'>()
  const run = async (k: 'resend' | 'revoke') => {
    setBusy(k)
    try {
      if (k === 'resend') {
        const next = await resendInvite(i.id)
        onResent(next)
        await copyLink(next.link)
        toast.success(`New link for ${i.email}`, { description: 'Share this link with them.' })
      } else {
        await revokeInvite(i.id)
        onRevoked()
        toast.success('Invite revoked')
      }
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <motion.li {...rowMotion} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-dashed text-muted-foreground"><EnvelopeSimple size={16} aria-hidden /></span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-medium">{i.email}</p>
        <p className="truncate text-xs text-muted-foreground">Invited by {i.invited_by.name} · expires {date(i.expires_at)}</p>
      </div>
      <span className="w-24 text-sm text-ink-2">{roleLabel(i.role)}</span>
      {admin && (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={async () => (await copyLink(i.link)) ? toast.success('Invite link copied. Share it with them.') : toast.error('Couldn’t copy. Select the link from your browser instead.')}><LinkSimple aria-hidden /> Copy invite link</Button>
          <Button variant="ghost" size="sm" onClick={() => run('resend')} disabled={!!busy}>{busy === 'resend' ? <Loader /> : <ArrowClockwise aria-hidden />} New link</Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-stop" onClick={() => run('revoke')} disabled={!!busy} aria-label={`Revoke the invite to ${i.email}`}><X aria-hidden /></Button>
        </div>
      )}
    </motion.li>
  )
}

// ── Profile ────────────────────────────────────────────────────────────────────

const NOTIFY: { key: keyof Me['notifications']; label: string; hint: string }[] = [
  { key: 'low_balance', label: 'Low balance', hint: 'When credits won’t last about a week at your current pace' },
  { key: 'run_finished', label: 'A run finished', hint: 'When an upload you started is analysed' },
  { key: 'shared_chats', label: 'Shared chats', hint: 'When a teammate shares an alteria chat in your projects' },
  { key: 'weekly_digest', label: 'Weekly digest', hint: 'Monday morning: what changed in your trackers last week' },
]

export function ProfileTab() {
  const { data: me, error } = useMe()
  const [name, setName] = useState<string>()
  const [saving, setSaving] = useState(false)
  if (error && !me) return <ErrorNote>Couldn’t load your profile. {error}</ErrorNote>
  if (!me) return <div className="skeleton h-72 rounded-xl" />
  const value = name ?? me.name
  const dirty = value.trim() !== me.name

  const saveName = async () => {
    setSaving(true)
    try {
      setMe(await updateMe({ name: value }))
      setName(undefined)
      toast.success('Name saved')
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }
  const notify = async (key: keyof Me['notifications'], on: boolean) => {
    const before = me
    setMe({ ...me, notifications: { ...me.notifications, [key]: on } })
    try {
      setMe(await updateMe({ notifications: { [key]: on } }))
    } catch (e) {
      setMe(before)
      toast.error((e as ApiError).message)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <section className="surface px-5 py-5" aria-labelledby="you-h">
        <h2 id="you-h" className="sr-only">You</h2>
        <div className="flex items-center gap-4">
          <Avatar p={{ ...me, name: value || me.name }} size={56} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-tight">{me.name}</p>
            <p className="text-sm text-muted-foreground">{roleLabel(me.role)} · joined {date(me.joined_at)}</p>
          </div>
        </div>
        <form onSubmit={(e) => (e.preventDefault(), dirty && saveName())} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <span className="flex gap-2">
              <Input value={value} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-9 bg-card" />
              <AnimatePresence initial={false}>
                {dirty && (
                  <motion.span initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                    <Button type="submit" disabled={saving || !value.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">Teammates see it on chats you share.</span>
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-medium">Email</span>
            <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-ink-2">{me.email}</p>
          </div>
        </form>

        <h3 className="mt-8 mb-2 text-sm font-medium">Sign-in</h3>
        <ul className="divide-y rounded-xl border">
          <li className="flex items-center gap-3 px-4 py-3 text-sm">
            <EnvelopeSimple size={18} className="text-muted-foreground" aria-hidden />
            <span className="flex-1">Email link</span>
            {me.sign_in.email && <span className="flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle weight="fill" aria-hidden /> On</span>}
          </li>
          <li className="flex items-center gap-3 px-4 py-3 text-sm">
            <GoogleLogo size={18} className="text-muted-foreground" aria-hidden />
            <span className="flex-1">Google</span>
            {me.sign_in.google ? <span className="flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle weight="fill" aria-hidden /> Connected</span> : <Button size="sm" variant="outline">Connect</Button>}
          </li>
        </ul>
      </section>

      <section aria-labelledby="notify-h">
        <h2 id="notify-h" className="mb-2 text-sm font-medium text-muted-foreground">Email me about</h2>
        <ul className="surface divide-y">
          {NOTIFY.map((n) => (
            <li key={n.key} className="flex items-center gap-4 px-5 py-3.5">
              <label htmlFor={`n-${n.key}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm font-medium">{n.label}</span>
                <span className="block text-sm text-ink-2">{n.hint}</span>
              </label>
              <Switch id={`n-${n.key}`} checked={me.notifications[n.key]} onCheckedChange={(on) => notify(n.key, on)} />
            </li>
          ))}
        </ul>
        <div className="mt-8 rounded-xl border border-dashed px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-medium"><Trash size={15} className="text-muted-foreground" aria-hidden /> Leave or delete</p>
          <p className="mt-1 text-sm text-ink-2">{me.role === 'owner' ? 'To delete the workspace, first remove everyone else, or make another admin the owner.' : 'Leaving removes your access. Chats you shared stay with the team.'}</p>
          <p className="mt-2 text-xs text-muted-foreground">Comes with sign-in (B42).</p>
        </div>
      </section>
    </div>
  )
}
