// Firebase Authentication (Google sign-in). Active only when VITE_FIREBASE_* is set; without it the
// app signs in as before (the dev proxy's API key, or the mock). The backend verifies the ID token
// this module hands to http-api.ts on every request.
import { initializeApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth'

const env = import.meta.env
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

/** True when this build has Firebase config, so sign-in is Google via Firebase. */
export const FIREBASE_ON = !!(config.apiKey && config.projectId && config.appId)

const auth: Auth | null = FIREBASE_ON ? getAuth(initializeApp(config)) : null

/** Resolves once Firebase has restored any saved session (and finished a redirect sign-in), so
 *  the first API call doesn't go out unsigned just because the SDK was still starting. */
const ready: Promise<unknown> = auth
  ? Promise.all([auth.authStateReady(), getRedirectResult(auth).catch(() => null)])
  : Promise.resolve()

/** The current ID token, refreshed by the SDK when it is about to expire. Null when signed out. */
export async function getIdToken(): Promise<string | null> {
  if (!auth) return null
  await ready
  return (await auth.currentUser?.getIdToken()) ?? null
}

/** Whether a Firebase user is signed in right now (after the session is restored). */
export const onAuthChange = (fn: (signedIn: boolean) => void) => (auth ? onAuthStateChanged(auth, (u) => fn(!!u)) : () => undefined)

const POPUP_FALLBACK = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'])

/** Google sign-in in a popup; if the browser blocks it, a full-page redirect (it returns to this
 *  page and `ready` finishes the sign-in). Resolves false when the page is leaving. */
export async function signInWithGoogle(): Promise<boolean> {
  if (!auth) return false
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    await signInWithPopup(auth, provider)
    return true
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (!POPUP_FALLBACK.has(code)) throw e
    await signInWithRedirect(auth, provider)
    return false
  }
}

export async function signOutOfFirebase(): Promise<void> {
  if (auth) await firebaseSignOut(auth)
}
