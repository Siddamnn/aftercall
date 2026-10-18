// Who may see the app. The backend decides (a session cookie, B42); this only sends people to the
// right page: signed out → /login, new → /onboarding. Before the backend has /me, the app opens as
// it did (one tenant, one key in the dev proxy).
import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { toast } from './lib/toast'
import { onSignedOut, signOut } from './api'
import { PageLoader } from './loaders'
import { useNoIndex } from './lib/hooks'
import { reloadMe, useMe } from './people'

/** Where to come back to after signing in: only paths on this site, never another origin. */
export function safeNext(next: string | null, fallback = '/insights') {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback
}

// The page someone was on, so signing in again (after the 5-hour limit, or a closed tab) resumes
// there. Only the path: nothing from the page itself.
const RESUME_KEY = 'resume-path'
export const resumePath = () => {
  try {
    return localStorage.getItem(RESUME_KEY)
  } catch {
    return null
  }
}
const remember = (path: string) => {
  try {
    localStorage.setItem(RESUME_KEY, path)
  } catch {
    // Not resumed; fine.
  }
}

/** B64: a sign-in lasts 5 hours. A warning 5 minutes before, then sign-out, then back here after
 *  signing in again. The backend refuses the session at the same moment, so this is only courtesy. */
function useSessionLimit(expiresAt: string | undefined, here: string) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!expiresAt) return
    const end = Date.parse(expiresAt)
    const warnAt = end - 5 * 60_000
    const time = new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const timers = [
      setTimeout(() => toast.warning(`You’ll be signed out at ${time}`, {
        id: 'session', duration: Infinity, className: 'toast-sticky',
        description: 'Sign-ins last 5 hours, for security. Sign in again after and you’ll come back to this page.',
      }), Math.max(0, warnAt - Date.now())),
      setTimeout(async () => {
        toast.dismiss('session')
        const at = location.pathname + location.search
        remember(at)
        await signOut().catch(() => undefined)
        navigate(`/login?expired=1&next=${encodeURIComponent(at)}`, { replace: true })
        void reloadMe().catch(() => undefined)
      }, Math.max(0, end - Date.now())),
    ]
    return () => timers.forEach(clearTimeout)
  }, [expiresAt, navigate])
  useEffect(() => remember(here), [here])
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const here = pathname + search
  useNoIndex()
  useSessionLimit(me.data?.session_expires_at, here)

  // Any request that comes back 401 (the session ran out mid-visit) goes to sign-in, then back here.
  useEffect(() => onSignedOut(() => {
    remember(location.pathname + location.search)
    navigate(`/login?expired=1&next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
  }), [navigate])

  if (me.status === 401) return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />
  if (!me.data && !me.error) return <PageLoader full label="Loading" />
  if (me.data && me.data.onboarded === false) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

/** Sign out, forget who was signed in, and go to /login. */
export function useSignOut() {
  const navigate = useNavigate()
  return async () => {
    try {
      await signOut()
    } finally {
      // Leave the app first, so the 401 that follows isn't read as "your session ran out".
      navigate('/login?signed-out=1', { replace: true })
      await reloadMe().catch(() => undefined)
    }
  }
}
