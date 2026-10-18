// /invite/:token: the invite link someone shared with you. Shows who invited you to what, then signs you in
// (as the invited address) and joins. Signed in already, as that address: one Accept button.
import { EnvelopeSimple, GoogleLogo, Warning } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from '../lib/toast'
import { acceptInvite, getInvite, googleSignInUrl, type ApiError } from '../api'
import { AuthShell } from '../auth-shell'
import { Button } from '../components/ui/button'
import { Loader, PageLoader } from '../loaders'
import { useLoad } from '../lib/hooks'
import { Avatar, roleLabel, ROLES, setMe, useMe } from '../people'
import { projectsChanged } from '../project'
import { HOST } from '../lib/workspace'

export default function Invite() {
  const { token = '' } = useParams()
  const invite = useLoad(() => getInvite(token), [token])
  const me = useMe().data
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const here = `/invite/${encodeURIComponent(token)}`

  if (invite.error) {
    return (
      <AuthShell>
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-stop-soft text-stop"><Warning size={24} weight="duotone" aria-hidden /></span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">This invite can’t be used</h1>
          <p className="mt-1.5 text-ink-2 text-pretty" role="alert">{invite.error}</p>
          <Button asChild variant="outline" className="mt-6"><Link to="/login">Sign in instead</Link></Button>
        </div>
      </AuthShell>
    )
  }
  if (!invite.data) return <PageLoader full label="Opening your invite" />
  const inv = invite.data
  const sameEmail = me?.email.toLowerCase() === inv.email.toLowerCase()

  const accept = async () => {
    setBusy(true)
    try {
      setMe(await acceptInvite(token))
      projectsChanged()
      toast.success(`Welcome to ${inv.workspace.name}`)
      navigate('/insights', { replace: true })
    } catch (e) {
      toast.error((e as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <div className="text-center">
        <div className="relative mx-auto w-fit">
          <span className="grid size-16 place-items-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-panel" aria-hidden>
            {inv.workspace.logo_url ? <img src={inv.workspace.logo_url} alt="" className="size-full rounded-2xl object-cover" /> : inv.workspace.name.trim()[0]?.toUpperCase()}
          </span>
          <Avatar p={inv.invited_by} size={28} ring className="absolute -right-2 -bottom-2" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">Join {inv.workspace.name} on aftercall</h1>
        <p className="mt-1.5 text-ink-2 text-pretty">
          <b className="font-medium text-foreground">{inv.invited_by.name}</b> invited <b className="font-medium break-all text-foreground">{inv.email}</b> as {/^[aeiou]/i.test(roleLabel(inv.role)) ? 'an' : 'a'} {roleLabel(inv.role).toLowerCase()}.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{HOST}/{inv.workspace.slug}</p>
      </div>

      <p className="mt-6 rounded-xl border bg-card px-4 py-3 text-sm text-ink-2">{ROLES.find((r) => r.id === inv.role)?.can}.</p>

      <div className="mt-6 space-y-2">
        {sameEmail ? (
          <Button size="lg" className="w-full" onClick={accept} disabled={busy}>{busy ? <><Loader /> Joining…</> : <>Accept and join</>}</Button>
        ) : (
          <>
            {me && (
              <p className="mb-3 text-center text-sm text-ink-2">
                You’re signed in as {me.email}. This invite is for {inv.email}, so sign in with that address.
              </p>
            )}
            <Button size="lg" variant="outline" className="w-full bg-card" onClick={() => location.assign(googleSignInUrl(here))}>
              <GoogleLogo weight="bold" aria-hidden /> Continue with Google
            </Button>
            <Button size="lg" className="w-full" asChild>
              <Link to={`/login?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(here)}`}><EnvelopeSimple aria-hidden /> Continue with email</Link>
            </Button>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Expires {new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.
      </p>
    </AuthShell>
  )
}
