// /login and /signup: Google through Firebase when this build has it (src/firebase.ts), otherwise
// Google or a sign-in link by email. One flow for both: a new person gets /onboarding.
// /login/verify is where the emailed link and Google come back to (Verify below).
import { ArrowLeft, CheckCircle, EnvelopeSimple, GoogleLogo, Info, Warning } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { googleSignInUrl, requestSignInLink, USING_MOCK, verifySignIn, type ApiError } from '../api'
import { AuthShell } from '../auth-shell'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Loader, LogoLoader } from '../loaders'
import { ease } from '../lib/motion'
import { reloadMe, useMe } from '../people'
import { resumePath, safeNext } from '../session'
import { Meter } from '../ui'
import { markLogin } from '../upgrade'
import { BILLING_ON, MOTTO } from '../config'
import { FIREBASE_ON, signInWithGoogle } from '../firebase'

const RESEND_AFTER = 30

export default function Login() {
  const signup = useLocation().pathname === '/signup'
  const [params] = useSearchParams()
  const next = params.get('next')
  const me = useMe().data
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [sent, setSent] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Already signed in (a bookmarked /login, or back from a Google redirect): straight on.
  if (me && me.onboarded !== false) return <Navigate to={safeNext(next)} replace />
  if (me && FIREBASE_ON) return <Navigate to="/onboarding" replace />

  const google = async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (!(await signInWithGoogle())) return // redirecting away; it comes back signed in
      await reloadMe()
      markLogin()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError('Google sign-in didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const address = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return setError('Enter your work email, like name@company.com')
    setBusy(true)
    setError(undefined)
    try {
      await requestSignInLink(address, next ?? undefined)
      setSent(address)
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const note = params.has('expired')
    ? 'Your session ended. Sign in again to carry on where you were.'
    : params.has('signed-out') ? 'You’re signed out.' : undefined

  return (
    <AuthShell aside={<Aside />}>
      <AnimatePresence mode="wait" initial={false}>
        {sent ? (
          <CheckInbox key="sent" email={sent} next={next} onBack={() => setSent(undefined)} onResend={() => requestSignInLink(sent, next ?? undefined)} />
        ) : (
          <motion.div key="form" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }}>
            <h1 className="text-2xl font-semibold tracking-tight">{signup ? 'Create your account' : 'Sign in to aftercall'}</h1>
            <p className="mt-1.5 text-ink-2">{BILLING_ON && signup ? 'Start with trial credit, on your own conversations.' : MOTTO}</p>

            {note && (
              <p className="mt-5 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-ink-2" role="status">
                <Info size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden /> {note}
              </p>
            )}

            <Button
              variant={FIREBASE_ON ? 'default' : 'outline'} size="lg" className={FIREBASE_ON ? 'mt-6 w-full' : 'mt-6 w-full bg-card'} disabled={busy}
              onClick={FIREBASE_ON ? google : () => location.assign(googleSignInUrl(next ?? undefined))}
            >
              <GoogleLogo weight="bold" aria-hidden /> Continue with Google
            </Button>
            {FIREBASE_ON && error && (
              <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-stop"><Warning size={14} weight="fill" aria-hidden /> {error}</p>
            )}

            {!FIREBASE_ON && <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>}

            {!FIREBASE_ON && <form onSubmit={send} noValidate>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Work email</label>
              <Input
                id="email" type="email" autoComplete="email" inputMode="email" autoFocus placeholder="you@company.com"
                value={email} onChange={(e) => (setEmail(e.target.value), setError(undefined))}
                aria-invalid={!!error} aria-describedby={error ? 'email-error' : 'email-hint'} className="h-10 bg-card"
              />
              <AnimatePresence initial={false} mode="wait">
                {error ? (
                  <motion.p key="e" id="email-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-sm text-stop" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: [0, -3, 3, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                    <Warning size={14} weight="fill" aria-hidden /> {error}
                  </motion.p>
                ) : (
                  <motion.p key="h" id="email-hint" className="mt-1.5 text-xs text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    With your work email, teammates at your company can find your workspace.
                  </motion.p>
                )}
              </AnimatePresence>
              <Button type="submit" size="lg" className="mt-4 w-full" disabled={busy}>
                {busy ? <><Loader /> Sending…</> : <><EnvelopeSimple aria-hidden /> Email me a sign-in link</>}
              </Button>
            </form>}

            <p className="mt-6 text-center text-sm text-ink-2">
              {signup
                ? <>Have an account? <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary hover:underline">Sign in</Link></>
                : <>New to aftercall? <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary hover:underline">Create an account</Link></>}
            </p>
            <p className="mt-3 text-center text-xs text-muted-foreground text-pretty">
              By continuing you agree to aftercall’s <Link to="/docs/terms" className="underline hover:text-foreground">terms</Link> and <Link to="/docs/privacy" className="underline hover:text-foreground">privacy policy</Link>.{!FIREBASE_ON && ' We only email you about your account.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  )
}

function CheckInbox({ email, next, onBack, onResend }: { email: string; next: string | null; onBack: () => void; onResend: () => Promise<void> }) {
  const [wait, setWait] = useState(RESEND_AFTER)
  const [resent, setResent] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])
  const domain = email.split('@')[1]?.toLowerCase()
  const inbox = domain === 'gmail.com' || domain === 'googlemail.com' ? 'https://mail.google.com' : domain && /outlook|hotmail|live\./.test(domain) ? 'https://outlook.live.com' : null

  return (
    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }}>
      <motion.span
        className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary"
        initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.4 }}
      >
        <EnvelopeSimple size={24} weight="duotone" aria-hidden />
      </motion.span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Check your email</h1>
      <p className="mt-1.5 text-ink-2" role="status">
        We sent a sign-in link to <b className="font-medium break-all text-foreground">{email}</b>. It works once, for 15 minutes.
      </p>
      {inbox && <Button asChild size="lg" className="mt-6 w-full"><a href={inbox} target="_blank" rel="noreferrer">Open your inbox</a></Button>}
      {USING_MOCK && (
        <Button size="lg" variant={inbox ? 'outline' : 'default'} className="mt-6 w-full" onClick={() => navigate(`/login/verify?token=mock${next ? `&next=${encodeURIComponent(next)}` : ''}`)}>
          Open the link (mock)
        </Button>
      )}
      <div className="mt-6 flex items-center justify-between gap-2 text-sm">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-ink-2 hover:text-foreground"><ArrowLeft size={14} aria-hidden /> Use another email</button>
        <button
          disabled={wait > 0}
          onClick={() => void onResend().then(() => (setResent(true), setWait(RESEND_AFTER)))}
          className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
        >
          {wait > 0 ? <span className="tabular-nums">Resend in {wait}s</span> : 'Resend the link'}
        </button>
      </div>
      <AnimatePresence>
        {resent && wait > RESEND_AFTER - 4 && (
          <motion.p className="mt-3 flex items-center gap-1.5 text-sm text-ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CheckCircle weight="fill" aria-hidden /> Sent again
          </motion.p>
        )}
      </AnimatePresence>
      <p className="mt-8 text-xs text-muted-foreground">Nothing after a minute? Check spam, or that the address is right.</p>
    </motion.div>
  )
}

/** The right-hand panel: what aftercall does, in one answered question. */
function Aside() {
  const rows = [
    { q: 'Did the agent confirm the booking?', a: 'Yes', c: 0.97 },
    { q: 'Why did the customer call?', a: 'Reschedule', c: 0.91 },
    { q: 'How frustrated was the caller?', a: '2 of 5', c: 0.84 },
  ]
  return (
    <div className="flex h-full flex-col justify-center px-12 py-16">
      <p className="text-sm font-medium text-primary">aftercall</p>
      <h2 className="mt-2 max-w-[18ch] text-3xl font-semibold tracking-tight text-balance">Ask every conversation the same question.</h2>
      <p className="mt-3 max-w-[40ch] text-ink-2">Calls and chats, answered the same way every time, with a confidence score on every answer.</p>
      <ul className="mt-10 space-y-2.5">
        {rows.map((r, i) => (
          <motion.li
            key={r.q} className="rounded-xl border bg-background px-4 py-3 shadow-panel"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: 0.3 + i * 0.12 }}
          >
            <p className="text-sm text-ink-2">{r.q}</p>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="font-medium">{r.a}</span>
              <Meter value={r.c} className="w-24" />
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

/** /login/verify?token=…&next=…: the emailed link, or Google, lands here. Sets the session, then on. */
export function Verify() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const next = params.get('next')
  const [error, setError] = useState<string>()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // a link works once: don't spend it twice in StrictMode
    ran.current = true
    if (!token) return setError('This link is missing its code. Open it from the email again, or ask for a new one.')
    verifySignIn(token).then(
      async ({ new_user }) => {
        await reloadMe()
        // Back to the page they were on (the link's `next`, or where the last session ended).
        markLogin()
        navigate(new_user ? '/onboarding' : safeNext(next ?? resumePath()), { replace: true })
      },
      (e: ApiError) => setError(e.message),
    )
  }, [token, next, navigate])

  return (
    <AuthShell>
      {error ? (
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-stop-soft text-stop"><Warning size={24} weight="duotone" aria-hidden /></span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">That link didn’t work</h1>
          <p className="mt-1.5 text-ink-2 text-pretty" role="alert">{error}</p>
          <Button asChild size="lg" className="mt-6 w-full"><Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Send a new link</Link></Button>
        </div>
      ) : (
        <div className="flex justify-center">
          <LogoLoader size={56} label="Signing you in" />
        </div>
      )}
    </AuthShell>
  )
}
