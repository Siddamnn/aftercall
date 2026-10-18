// Toasts, set up once for the whole app:
// - Every <Toaster> uses `toasterProps`: top right on every page (the user's call, 2026-09-27), a
//   fixed time on screen, and the blue timer ring in index.css that runs for the same time.
// - Two kinds of toast:
//   - `toast.success/error/…`: **indicators** ("Saved", "Copied", an action failed). Sonner's usual
//     fade, and gone: they don't belong in the bell.
//   - `toast.notify(…)`: **notifications**, things worth finding later. Timed out without being
//     dismissed, it flies into the bell (sidebar open, collapsed, or the phone's top bar) and is
//     kept unread; dismissed, it fades and is kept read. Server notifications arrive this way too.
import { toast as sonner, type ExternalToast, type ToasterProps } from 'sonner'
import { rememberToast } from '../notifications-local'

export const TOAST_MS = 5000

export const toasterProps = (dark: boolean): ToasterProps => ({
  theme: dark ? 'dark' : 'light',
  position: 'top-right',
  duration: TOAST_MS,
  style: { '--toast-ms': `${TOAST_MS}ms` } as React.CSSProperties,
  // Pushed up or right, a toast goes (Sonner's swipe). A click dismisses it too: Sonner only does
  // that through its close button, so the button is on but hidden (index.css) and clicks go to it.
  swipeDirections: ['top', 'right'],
  closeButton: true,
  toastOptions: { className: '!font-sans !rounded-xl !border-border !shadow-float cursor-pointer' },
})

// A click on a toast, not on its buttons or links and not the end of a swipe, dismisses it the way
// its close button would (so a notification is kept as read).
if (typeof document !== 'undefined') {
  let down: { x: number; y: number } | null = null
  document.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY } }, true)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const el = target.closest?.<HTMLElement>('[data-sonner-toast]')
    if (!el || target.closest('button, a, input, [data-button]')) return
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return
    el.querySelector<HTMLButtonElement>('[data-close-button]')?.click()
  })
}

type Kind = 'info' | 'success' | 'error' | 'warning'
type Msg = Parameters<typeof sonner>[0]

/** The visible bell: the sidebar's, the rail's or the phone header's, whichever is on screen. */
const bell = () => [...document.querySelectorAll<HTMLElement>('[data-notification-bell]')].find((b) => b.offsetParent !== null && b.getBoundingClientRect().width > 0)

/** `keep: false` for toasts that are already in the bell (server notifications). */
export function flyToBell(title: string, description: string | undefined, kind: Kind, keep = true, concern: Concern = 'general') {
  const target = bell()
  const el = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].find((t) => t.textContent?.includes(title))
  if (keep) rememberToast({ title, body: description ?? null, kind, concern, read: false })
  if (!target || !el) return // outside the app (sign-in, docs): no bell, Sonner's own exit
  const from = el.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  const toaster = el.closest<HTMLElement>('[data-sonner-toaster]')
  // Hide the real toast at once, so Sonner's own exit doesn't run beside the flight.
  toaster?.setAttribute('data-flying', '')
  setTimeout(() => toaster?.removeAttribute('data-flying'), 450)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return void target.dispatchEvent(new Event('bell-catch'))

  // A copy of the toast as it looks now. Sonner's styles need its toaster around them, so the
  // copy takes the computed look instead.
  const cs = getComputedStyle(el)
  const ghost = el.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-sonner-toast')
  Object.assign(ghost.style, {
    display: cs.display, alignItems: cs.alignItems, gap: cs.gap, padding: cs.padding, background: cs.backgroundColor, color: cs.color,
    border: cs.border, boxShadow: cs.boxShadow, fontFamily: cs.fontFamily, fontSize: cs.fontSize, boxSizing: 'border-box', overflow: 'hidden',
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    margin: '0', zIndex: '9999', pointerEvents: 'none', transformOrigin: 'center', transform: 'none', opacity: '1',
  })
  document.body.appendChild(ghost)
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, filter: 'blur(0px)', borderRadius: '12px' },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35}px) scale(0.55)`, opacity: 0.85, filter: 'blur(0.5px)', offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, opacity: 0, filter: 'blur(2px)', borderRadius: '999px' },
    ],
    { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' },
  )
  flight.onfinish = () => {
    ghost.remove()
    target.dispatchEvent(new Event('bell-catch'))
  }
}

export type Concern = 'runs' | 'team' | 'billing' | 'alerts' | 'general'

/** A notification toast: kept in the bell under its concern (a tab there). */
function notify(title: string, o: ExternalToast & { concern?: Concern; kind?: Kind; href?: string; keep?: boolean } = {}) {
  const { concern = 'general', kind = 'info', keep = true, ...rest } = o
  const description = typeof rest.description === 'string' ? rest.description : undefined
  const show = kind === 'info' ? sonner : sonner[kind]
  return show(title, {
    ...rest,
    onAutoClose: (t) => {
      rest.onAutoClose?.(t)
      flyToBell(title, description, kind, keep, concern)
    },
    onDismiss: (t) => {
      rest.onDismiss?.(t)
      if (keep) rememberToast({ title, body: description ?? null, kind, concern, read: true })
    },
  })
}

/** Indicators pass straight through to Sonner; `notify` is the one that reaches the bell. */
export const toast = Object.assign((m: Msg, o?: ExternalToast) => sonner(m, o), {
  success: sonner.success,
  error: sonner.error,
  warning: sonner.warning,
  info: sonner.info,
  message: sonner.message,
  loading: sonner.loading,
  promise: sonner.promise,
  dismiss: sonner.dismiss,
  custom: sonner.custom,
  notify,
})
