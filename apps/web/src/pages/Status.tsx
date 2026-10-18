// Status pages: not found (404), no access (403), and something broke (500). Each has the mark
// telling the story: its waveform flat (nothing here), or the lens locked, or the bars stopped.
import { ArrowLeft, House, SignIn } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { isRouteErrorResponse, Link, useLocation, useNavigate, useRouteError } from 'react-router-dom'
import { AuthShell } from '../auth-shell'
import { MARK } from '../brand'
import { Button } from '../components/ui/button'
import { ease } from '../lib/motion'
import { useMe } from '../people'
import { CONTACT } from '../config'

type Kind = 'not-found' | 'forbidden' | 'error'

/** The mark, large. Not found: the waveform flattens to a line, then the lens sweeps. No access:
 *  a lock where the waveform was. Error: the bars stop at uneven heights. */
function StatusMark({ kind }: { kind: Kind }) {
  const reduced = useReducedMotion()
  const flat = kind === 'not-found'
  return (
    <svg viewBox="12 12 40 40" width={96} height={96} aria-hidden className="mx-auto">
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: '40% 40%' }}
        animate={flat && !reduced ? { rotate: [0, -8, 6, 0] } : undefined}
        transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }}
      >
        <path d={MARK.handset} fill="var(--primary)" opacity={kind === 'forbidden' ? 0.35 : 1} />
        <path d={MARK.lens} fill="none" stroke="var(--foreground)" strokeWidth="4.4" strokeLinecap="round" />
        <path d={MARK.handle} stroke="var(--foreground)" strokeWidth="5.2" strokeLinecap="round" />
      </motion.g>
      {kind === 'forbidden' ? (
        <motion.g initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease, delay: 0.15 }}>
          <rect x="27.4" y="28.6" width="8" height="6.4" rx="1.4" fill="var(--primary)" />
          <path d="M29.2 28.6v-1.6a2.2 2.2 0 0 1 4.4 0v1.6" fill="none" stroke="var(--primary)" strokeWidth="1.5" />
        </motion.g>
      ) : (
        MARK.bars.map(([x, a, b], i) => {
          const mid = (a + b) / 2
          const to = flat ? 0.12 : [0.9, 0.35, 0.6][i]
          return (
            <motion.line
              key={x} x1={x} x2={x} y1={a} y2={b} stroke="var(--primary)" strokeWidth="1.95" strokeLinecap="round"
              style={{ transformBox: 'fill-box', transformOrigin: `50% ${mid}px` }}
              initial={{ scaleY: 1 }} animate={{ scaleY: to }} transition={{ duration: 0.6, ease, delay: 0.2 + i * 0.08 }}
            />
          )
        })
      )}
    </svg>
  )
}

function StatusPage({ kind, code, title, children, actions, inline }: { kind: Kind; code: string; title: string; children: ReactNode; actions: ReactNode; inline?: boolean }) {
  const body = (
      <div className={inline ? 'py-16 text-center' : 'text-center'}>
        <StatusMark kind={kind} />
        <p className="mt-6 font-mono text-xs tracking-wider text-muted-foreground uppercase">{code}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <div className="mx-auto mt-2 max-w-[46ch] text-ink-2 text-pretty">{children}</div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      </div>
  )
  return inline ? body : <AuthShell wide>{body}</AuthShell>
}

function Back() {
  const navigate = useNavigate()
  if (history.length <= 1) return null
  return <Button variant="outline" onClick={() => navigate(-1)}><ArrowLeft aria-hidden /> Go back</Button>
}

/** Where "home" is: the app for someone signed in, the landing page otherwise. */
function Home() {
  const me = useMe().data
  return me
    ? <Button asChild><Link to="/insights"><House aria-hidden /> Go to Insights</Link></Button>
    : <Button asChild><Link to="/"><House aria-hidden /> aftercall home</Link></Button>
}

export default function NotFound() {
  const { pathname } = useLocation()
  return (
    <StatusPage kind="not-found" code="404 · not found" title="Nothing on this line" actions={<><Back /><Home /></>}>
      There's no page at <span className="font-mono text-[0.9em] break-all text-foreground">{pathname}</span>. It may have moved, or the link has a typo.
    </StatusPage>
  )
}

/** 403: signed in, but this isn't theirs to see. `inline` shows it inside the app, where a page
 *  the role can't open would be (access.ts). */
export function Forbidden({ inline }: { inline?: boolean }) {
  const me = useMe().data
  return (
    <StatusPage
      inline={inline} kind="forbidden" code="403 · no access" title="You don't have access to this"
      actions={<><Back /><Home /></>}
    >
      {me
        ? <>You're signed in as <b className="font-medium text-foreground">{me.email}</b>, and {me.role === 'viewer' ? 'viewers' : `${me.role}s`} can't open this page. An owner or admin can change your role in Settings → Team.</>
        : <>This belongs to a workspace you're not in. Ask someone in it for an invite, or sign in with another account.</>}
    </StatusPage>
  )
}

/** Signed out, on a page that needs signing in. Routes normally redirect to /login instead. */
export function SignedOut() {
  const { pathname, search } = useLocation()
  return (
    <StatusPage
      kind="forbidden" code="401 · signed out" title="Sign in to see this"
      actions={<Button asChild><Link to={`/login?next=${encodeURIComponent(pathname + search)}`}><SignIn aria-hidden /> Sign in</Link></Button>}
    >
      Your session ended, or you haven't signed in on this browser yet.
    </StatusPage>
  )
}

/** The router's error page: a 404 from the router is "not found"; anything else broke. */
export function Crashed() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  if (isRouteErrorResponse(error) && error.status === 403) return <Forbidden />
  // Chunk loads fail after a deploy (the old page asks for files that are gone): a reload fixes it.
  const message = error instanceof Error ? error.message : undefined
  const stale = !!message && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)
  return (
    <StatusPage
      kind="error" code="500 · something broke" title={stale ? 'aftercall was updated' : 'Something went wrong on this page'}
      actions={<><Button onClick={() => location.reload()}>Reload</Button><Home /></>}
    >
      {stale
        ? 'A new version came out while this page was open. Reload to get it; nothing you saved is lost.'
        : <>Reloading usually fixes it. If it keeps happening, email <a href={`mailto:${CONTACT}`} className="font-medium text-primary hover:underline">{CONTACT}</a> with what you were doing.</>}
      {import.meta.env.DEV && message && <span className="mt-3 block font-mono text-xs text-muted-foreground">{message}</span>}
    </StatusPage>
  )
}
