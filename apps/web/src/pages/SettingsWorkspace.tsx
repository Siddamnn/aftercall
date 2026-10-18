// Settings → Workspace (B50): its name and address (with a preview of the sidebar block, your name
// under it), and who can join by email domain. Owners and admins edit; everyone else reads. Your own
// name is changed in Profile only.
import { At, Plus, UsersThree, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from '../lib/toast'
import { getWorkspace, updateWorkspace, type ApiError, type Workspace, type WorkspacePatch } from '../api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Loader } from '../loaders'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { domainOf, HOST, isCompanyDomain } from '../lib/workspace'
import { Avatar, canManageTeam, useMe } from '../people'
import { projectsChanged } from '../project'
import { ErrorNote } from '../ui'
import { SlugField } from '../workspace-fields'

export function WorkspaceTab() {
  const loaded = useLoad(getWorkspace, [])
  const [ws, setWs] = useState<Workspace>()
  const w = ws ?? loaded.data
  const me = useMe().data
  const admin = canManageTeam(me?.role)

  if (loaded.error && !w) return <ErrorNote onRetry={loaded.reload}>Couldn’t load the workspace. {loaded.error}</ErrorNote>
  if (!w || !me) return <div className="space-y-3"><div className="skeleton h-72 rounded-xl" /><div className="skeleton h-48 rounded-xl" /></div>

  const save = async (patch: WorkspacePatch, done: string) => {
    try {
      const next = await updateWorkspace(patch)
      setWs(next)
      projectsChanged() // the sidebar and Overview read the name through /account
      toast.success(done)
      return true
    } catch (e) {
      toast.error((e as ApiError).message)
      return false
    }
  }

  return (
    <div className="space-y-8">
      <Names w={w} admin={admin} onSave={save} />
      <Domains w={w} admin={admin} myDomain={domainOf(me.email)} onSave={save} />
    </div>
  )
}

type Save = (patch: WorkspacePatch, done: string) => Promise<boolean>

/** The workspace's name and address. The preview shows the sidebar's account block, your name under it. */
function Names({ w, admin, onSave }: { w: Workspace; admin: boolean; onSave: Save }) {
  const me = useMe().data!
  const [name, setName] = useState(w.name)
  const [slug, setSlug] = useState(w.slug)
  const [slugOk, setSlugOk] = useState(true)
  const [busy, setBusy] = useState(false)
  const onSlugValid = useCallback((ok: boolean) => setSlugOk(ok), [])

  const dirty = name.trim() !== w.name || slug !== w.slug
  const valid = name.trim().length >= 2 && slugOk

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const patch: WorkspacePatch = {}
    if (name.trim() !== w.name) patch.name = name.trim()
    if (slug !== w.slug) patch.slug = slug
    await onSave(patch, slug !== w.slug ? `Your workspace is now at ${HOST}/${slug}` : 'Workspace renamed')
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_18rem]" aria-labelledby="ws-h">
      <section className="surface px-5 py-5">
        <h2 id="ws-h" className="text-base font-semibold tracking-tight">Workspace</h2>
        <p className="mt-0.5 text-sm text-ink-2">Your company or team. Everyone in it shares its projects, plan and credits.</p>
        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="ws-name" className="mb-1.5 block text-sm font-medium">Workspace name</label>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!admin} placeholder="Sunrise Clinic" className="h-10 bg-card" />
          </div>
          <div>
            <label htmlFor="ws-slug" className="mb-1.5 block text-sm font-medium">Address</label>
            {admin
              ? <SlugField id="ws-slug" value={slug} current={w.slug} onChange={setSlug} onValid={onSlugValid} />
              : <p className="flex h-10 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm text-ink-2">{HOST}/{w.slug}</p>}
            {admin && slug !== w.slug && slugOk && (
              <p className="-mt-1 text-xs text-warn">Old links to {HOST}/{w.slug} will stop working.</p>
            )}
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-medium">Your name</span>
            <p className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-ink-2"><Avatar p={me} size={20} /> {me.name}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">Shown under the workspace name. <Link to="/settings/profile" className="font-medium text-primary hover:underline">Change it in Profile</Link></p>
          </div>
          {!admin && <p className="text-xs text-muted-foreground">Only the owner and admins can change the workspace’s name and address.</p>}
        </div>
        <AnimatePresence initial={false}>
          {dirty && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
              <div className="mt-5 flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="ghost" onClick={() => (setName(w.name), setSlug(w.slug))} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={!valid || busy}>{busy ? <><Loader /> Saving…</> : 'Save changes'}</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <aside aria-label="Preview">
        <p className="mb-2 text-sm font-medium text-muted-foreground">In the sidebar</p>
        <div className="rounded-xl border bg-background p-3 shadow-panel">
          <div className="flex items-center gap-2.5 rounded-lg p-1">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
              {(name.trim() || w.name)[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={name.trim() || w.name} className="block truncate text-sm font-medium" initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}>
                  {name.trim() || w.name}
                </motion.span>
              </AnimatePresence>
              <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <Avatar p={me} size={14} /> {me.name}
              </span>
            </span>
          </div>
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{HOST}/{slug || w.slug}</p>
      </aside>
    </form>
  )
}

/** Who may join without an invite: people with a verified email at one of these domains. */
function Domains({ w, admin, myDomain, onSave }: { w: Workspace; admin: boolean; myDomain?: string; onSave: Save }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string>()
  const suggest = myDomain && isCompanyDomain(myDomain) && !w.allowed_domains.includes(myDomain) ? myDomain : undefined

  const run = async (key: string, patch: WorkspacePatch, done: string) => {
    setBusy(key)
    const ok = await onSave(patch, done)
    setBusy(undefined)
    return ok
  }
  const add = async (d: string) => {
    const domain = d.trim().toLowerCase().replace(/^@/, '')
    if (!domain) return
    if (await run('add', { allowed_domains: [...w.allowed_domains, domain] }, `People at @${domain} can join`)) setDraft('')
  }

  return (
    <section className="surface px-5 py-5" aria-labelledby="dom-h">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-prose">
          <h2 id="dom-h" className="flex items-center gap-2 text-base font-semibold tracking-tight"><UsersThree size={18} className="text-muted-foreground" aria-hidden /> Join by email domain</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            Teammates who sign in with a verified email at these domains find this workspace and join without an invite.
            Only domains someone here has a verified email at can be added.
          </p>
        </div>
        <Switch
          checked={w.join_by_domain} disabled={!admin || !!busy || w.allowed_domains.length === 0}
          onCheckedChange={(on) => run('toggle', { join_by_domain: on }, on ? 'Joining by domain is on' : 'Joining by domain is off')}
          aria-label="Let people join by email domain"
        />
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {w.allowed_domains.map((d) => (
            <motion.li key={d} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              className="flex h-8 items-center gap-1.5 rounded-full border bg-card pr-1 pl-3 text-sm">
              <At size={13} className="text-muted-foreground" aria-hidden /> {d}
              {admin && (
                <button
                  onClick={() => run(`rm-${d}`, { allowed_domains: w.allowed_domains.filter((x) => x !== d), ...(w.allowed_domains.length === 1 ? { join_by_domain: false } : {}) }, `Removed @${d}`)}
                  disabled={!!busy} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${d}`}
                >
                  {busy === `rm-${d}` ? <Loader size={12} /> : <X size={12} aria-hidden />}
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
        {w.allowed_domains.length === 0 && <li className="text-sm text-muted-foreground">No domains yet: people join by invite only.</li>}
      </ul>

      {admin && (
        <form onSubmit={(e) => (e.preventDefault(), void add(draft))} className="mt-4 flex flex-wrap gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="sunriseclinic.com" aria-label="Add a domain" className="h-9 w-56 bg-card font-mono text-[0.875rem]" />
          <Button type="submit" variant="outline" disabled={!draft.trim() || !!busy}>{busy === 'add' ? <Loader /> : <Plus aria-hidden />} Add domain</Button>
          {suggest && !draft && (
            <Button type="button" variant="ghost" className="text-primary hover:text-primary" onClick={() => void add(suggest)} disabled={!!busy}>Add @{suggest}</Button>
          )}
        </form>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
        <span className="text-sm">People who join this way are</span>
        <Select value={w.default_role} disabled={!admin || !!busy} onValueChange={(r) => run('role', { default_role: r as Workspace['default_role'] }, `New people join as ${r}s`)}>
          <SelectTrigger className="h-8 w-32 bg-card" aria-label="Role for people who join by domain"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Members</SelectItem>
            <SelectItem value="viewer">Viewers</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Viewers are free. Members count toward pay as you go’s 3.</span>
      </div>
    </section>
  )
}
