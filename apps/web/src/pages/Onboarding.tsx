// /onboarding: a new account's first minute. Your name, then a workspace: join the one your company
// already has (people with the same email domain, when it allows that), or create one with a name
// and an address. Then what you'll analyse, and who to invite. One POST at the end (B50).
import { ArrowLeft, ArrowRight, Buildings, ChatsCircle, Headset, Plus, Robot, Sparkle, Trash, TrendUp, UsersThree } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from '../lib/toast'
import { completeOnboarding, listJoinable, type ApiError, type JoinableWorkspace, type Role, type UseCase } from '../api'
import { AuthShell } from '../auth-shell'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Loader, PageLoader } from '../loaders'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { domainOf, isCompanyDomain, slugify } from '../lib/workspace'
import { setMe, useMe } from '../people'
import { projectsChanged } from '../project'
import { SlugField } from '../workspace-fields'

type Step = 'you' | 'workspace' | 'use' | 'invite'

const USES: { id: UseCase; label: string; hint: string; Icon: typeof Headset }[] = [
  { id: 'sales', label: 'Sales calls', hint: 'Discovery, objections, next steps', Icon: TrendUp },
  { id: 'support', label: 'Support calls', hint: 'Resolution, sentiment, compliance', Icon: Headset },
  { id: 'voice_agents', label: 'Voice agents', hint: 'Did the AI agent do its job?', Icon: Robot },
  { id: 'chat', label: 'Chats and messages', hint: 'WhatsApp, web chat, email', Icon: ChatsCircle },
  { id: 'other', label: 'Something else', hint: 'Interviews, research, anything spoken', Icon: Sparkle },
]

type InviteRow = { email: string; role: Exclude<Role, 'owner'> }

export default function Onboarding() {
  const { data: me, status } = useMe()
  const navigate = useNavigate()
  const joinable = useLoad(listJoinable, [])
  const [step, setStep] = useState<Step>('you')
  const [dir, setDir] = useState(1)
  const [name, setName] = useState<string>()
  const [choice, setChoice] = useState<string>() // a joinable slug, or 'new'
  const [wsName, setWsName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [slugOk, setSlugOk] = useState(false)
  const [byDomain, setByDomain] = useState(true)
  const [use, setUse] = useState<UseCase>()
  const [invites, setInvites] = useState<InviteRow[]>([{ email: '', role: 'member' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // Where to go once set up. Saving the person re-renders this page as "already onboarded" before
  // the navigation lands, so that redirect goes here too.
  const [landing, setLanding] = useState('/insights')
  const onSlugValid = useCallback((ok: boolean) => setSlugOk(ok), [])

  // Pick the company's workspace by default when there is one to join.
  useEffect(() => {
    if (joinable.data && choice === undefined) {
      setChoice(joinable.data[0]?.slug ?? 'new')
      // A workspace already lets this domain join: a second one can't claim it too (B50).
      setByDomain(joinable.data.length === 0)
    }
  }, [joinable.data, choice])

  if (status === 401) return <Navigate to="/login?next=/onboarding" replace />
  if (!me) return <PageLoader full label="Getting things ready" />
  if (me.onboarded !== false) return <Navigate to={landing} replace />

  const domain = domainOf(me.email)
  const company = isCompanyDomain(domain)
  const yourName = name ?? me.name
  const joining = choice && choice !== 'new' ? joinable.data?.find((w) => w.slug === choice) : undefined
  const steps: Step[] = joining ? ['you', 'workspace'] : ['you', 'workspace', 'use', 'invite']
  const at = steps.indexOf(step)
  const last = at === steps.length - 1

  const go = (to: Step) => {
    setDir(steps.indexOf(to) > at ? 1 : -1)
    setError(undefined)
    setStep(to)
  }
  const canContinue =
    step === 'you' ? yourName.trim().length > 0
    : step === 'workspace' ? !!joining || (choice === 'new' && wsName.trim().length >= 2 && slugOk)
    : true

  const finish = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const rows = invites.filter((i) => i.email.trim())
      const done = await completeOnboarding(joining
        ? { name: yourName.trim(), join: joining.slug }
        : {
            name: yourName.trim(),
            workspace: { name: wsName.trim(), slug, allowed_domains: company && byDomain && domain ? [domain] : [], join_by_domain: company && byDomain },
            use_case: use,
            invites: rows,
          })
      const to = joining ? '/insights' : '/trackers'
      setLanding(to)
      setMe(done)
      projectsChanged()
      toast.success(joining ? `You joined ${joining.name}` : `${wsName.trim()} is ready`)
      navigate(to, { replace: true })
    } catch (e) {
      setError((e as ApiError).message)
      setBusy(false)
    }
  }
  const next = () => (last ? void finish() : go(steps[at + 1]))

  return (
    <AuthShell wide footer={false}>
      <div className="mb-8 flex items-center gap-1.5" aria-label={`Step ${at + 1} of ${steps.length}`}>
        {steps.map((s, i) => (
          <span key={s} className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.span className="absolute inset-0 origin-left rounded-full bg-primary" initial={false} animate={{ scaleX: i <= at ? 1 : 0 }} transition={{ duration: 0.35, ease }} />
          </span>
        ))}
      </div>

      <form onSubmit={(e) => (e.preventDefault(), canContinue && !busy && next())}>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step} custom={dir}
            variants={{ in: (d: number) => ({ opacity: 0, x: 16 * d, filter: 'blur(2px)' }), out: (d: number) => ({ opacity: 0, x: -12 * d, transition: { duration: 0.15 } }) }}
            initial="in" animate={{ opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.25, ease } }} exit="out"
          >
            {step === 'you' && (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">Welcome to aftercall</h1>
                <p className="mt-1.5 text-ink-2">Signed in as <b className="font-medium text-foreground">{me.email}</b>. What should your team call you?</p>
                <label htmlFor="ob-name" className="mt-6 mb-1.5 block text-sm font-medium">Your name</label>
                <Input id="ob-name" autoFocus autoComplete="name" maxLength={60} placeholder="Alex Morgan" value={yourName} onChange={(e) => setName(e.target.value)} className="h-10 bg-card" />
              </>
            )}

            {step === 'workspace' && (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">Your workspace</h1>
                <p className="mt-1.5 text-ink-2">Where your team’s trackers, conversations and credits live. Usually your company or clinic.</p>
                {joinable.loading && !joinable.data ? (
                  <div className="mt-6 space-y-2"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div>
                ) : (
                  <div role="radiogroup" aria-label="Workspace" className="mt-6 space-y-2">
                    {joinable.data?.map((w) => <JoinCard key={w.slug} w={w} domain={domain} on={choice === w.slug} onPick={() => setChoice(w.slug)} />)}
                    <button
                      type="button" role="radio" aria-checked={choice === 'new'} onClick={() => setChoice('new')}
                      className={cn('flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-[border-color,box-shadow] duration-150', choice === 'new' ? 'border-primary ring-3 ring-primary/15' : 'hover:border-muted-foreground/40')}
                    >
                      <span className="grid size-10 place-items-center rounded-lg border border-dashed text-muted-foreground"><Plus size={18} aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">Create a new workspace</span>
                        <span className="block text-sm text-ink-2">{joinable.data?.length ? 'For a separate team or client' : 'You’ll be its owner, and can invite your team next'}</span>
                      </span>
                    </button>
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {choice === 'new' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
                      <div className="space-y-4 px-0.5 pt-5 pb-1">
                        <div>
                          <label htmlFor="ob-ws" className="mb-1.5 block text-sm font-medium">Workspace name</label>
                          <Input
                            id="ob-ws" maxLength={60} placeholder="Sunrise Clinic" value={wsName} className="h-10 bg-card"
                            onChange={(e) => (setWsName(e.target.value), !slugEdited && setSlug(slugify(e.target.value)))}
                          />
                        </div>
                        <div>
                          <label htmlFor="ob-slug" className="mb-1.5 block text-sm font-medium">Address</label>
                          <SlugField id="ob-slug" value={slug} onChange={(v) => (setSlugEdited(true), setSlug(v))} onValid={onSlugValid} />
                        </div>
                        {company && domain && (
                          <label htmlFor="ob-domain" className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-4 py-3">
                            <UsersThree size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">Let anyone with an @{domain} email join</span>
                              <span className="block text-sm text-ink-2">They join as members, without an invite. You can change this in Settings.</span>
                            </span>
                            <Switch id="ob-domain" checked={byDomain} onCheckedChange={setByDomain} />
                          </label>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {step === 'use' && (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">What will you analyse first?</h1>
                <p className="mt-1.5 text-ink-2">We’ll name your first project for it and suggest trackers. You can add more projects later.</p>
                <div role="radiogroup" aria-label="What you'll analyse" className="mt-6 grid gap-2 sm:grid-cols-2">
                  {USES.map(({ id, label, hint, Icon }) => (
                    <button
                      key={id} type="button" role="radio" aria-checked={use === id} onClick={() => setUse(id)}
                      className={cn('flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-[border-color,box-shadow,transform] duration-150 active:scale-[0.98]', use === id ? 'border-primary ring-3 ring-primary/15' : 'hover:border-muted-foreground/40')}
                    >
                      <Icon size={20} weight={use === id ? 'fill' : 'regular'} className={cn('mt-0.5 shrink-0', use === id ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                      <span>
                        <span className="block text-sm font-medium">{label}</span>
                        <span className="block text-xs text-ink-2">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 'invite' && (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">Invite your team</h1>
                <p className="mt-1.5 text-ink-2">
                  You’ll get a link for each person to share, to join {wsName.trim() || 'your workspace'}.
                  {company && byDomain && domain && <> Anyone at @{domain} can also join on their own.</>}
                </p>
                <ul className="mt-6 space-y-2">
                  <AnimatePresence initial={false}>
                    {invites.map((row, i) => (
                      <motion.li key={i} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} className="flex gap-2">
                        <Input
                          type="email" inputMode="email" aria-label={`Teammate ${i + 1} email`} placeholder={domain && company ? `name@${domain}` : 'name@company.com'}
                          value={row.email} onChange={(e) => setInvites((xs) => xs.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} className="h-10 flex-1 bg-card"
                        />
                        <Select value={row.role} onValueChange={(r) => setInvites((xs) => xs.map((x, j) => (j === i ? { ...x, role: r as InviteRow['role'] } : x)))}>
                          <SelectTrigger className="h-10 w-28 bg-card" aria-label="Role"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                        {invites.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label="Remove" onClick={() => setInvites((xs) => xs.filter((_, j) => j !== i))}>
                            <Trash aria-hidden />
                          </Button>
                        )}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
                {invites.length < 5 && (
                  <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2 text-primary hover:text-primary" onClick={() => setInvites((xs) => [...xs, { email: '', role: 'member' }])}>
                    <Plus aria-hidden /> Add another
                  </Button>
                )}
                <p className="mt-3 text-xs text-muted-foreground">Viewers are free and don’t spend credits. On pay as you go, 3 people can ask and analyse.</p>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {error && <p role="alert" className="mt-5 rounded-lg border border-stop/25 bg-stop-soft px-3 py-2 text-sm">{error}</p>}

        <div className="mt-8 flex items-center justify-between gap-2">
          {at > 0 ? (
            <Button type="button" variant="ghost" onClick={() => go(steps[at - 1])} disabled={busy}><ArrowLeft aria-hidden /> Back</Button>
          ) : <span />}
          <div className="flex gap-2">
            {(step === 'use' || step === 'invite') && !last && <Button type="button" variant="ghost" onClick={() => go(steps[at + 1])}>Skip</Button>}
            {step === 'invite' && !invites.some((i) => i.email.trim()) ? (
              <Button type="submit" size="lg" disabled={busy}>{busy ? <><Loader /> Setting up…</> : <>Skip and finish</>}</Button>
            ) : (
              <Button type="submit" size="lg" disabled={!canContinue || busy}>
                {busy ? <><Loader /> {joining ? 'Joining…' : 'Setting up…'}</> : last ? (joining ? <>Join {joining.name}</> : <>Finish</>) : <>Continue <ArrowRight aria-hidden /></>}
              </Button>
            )}
          </div>
        </div>
      </form>
    </AuthShell>
  )
}

function JoinCard({ w, domain, on, onPick }: { w: JoinableWorkspace; domain?: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button" role="radio" aria-checked={on} onClick={onPick}
      className={cn('flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-[border-color,box-shadow] duration-150', on ? 'border-primary ring-3 ring-primary/15' : 'hover:border-muted-foreground/40')}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-base font-semibold text-primary-foreground" aria-hidden>
        {w.logo_url ? <img src={w.logo_url} alt="" className="size-full rounded-lg object-cover" /> : w.name.trim()[0]?.toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">Join {w.name}</span>
        <span className="flex items-center gap-1 text-sm text-ink-2">
          <Buildings size={13} aria-hidden /> {w.members} {w.members === 1 ? 'person' : 'people'}{domain && <> · everyone at @{domain}</>} · as {w.role}
        </span>
      </span>
    </button>
  )
}
