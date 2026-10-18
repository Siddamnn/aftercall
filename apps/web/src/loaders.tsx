// Loaders, all drawn from the two marks, so waiting always looks like aftercall:
// - Loader: the mark's three waveform bars, for buttons and inline "working" states.
// - LogoLoader: the whole mark draws itself, then its waveform plays. Page and app loads.
// - AlteriaLoader: alteria's ring turns while its wave plays. Anything alteria is doing.
// - PageLoader: a LogoLoader that waits 300 ms before showing, so fast loads don't flash.
// - RouteProgress: a thin bar at the top while the next page's code loads.
// With reduced motion the bars and the ring pulse in opacity instead of moving.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigation } from 'react-router-dom'
import { MARK } from './brand'
import { ease } from './lib/motion'
import { cn } from './lib/utils'

/** One bar of a waveform, looping. Heights are the mark's; each bar gets its own rhythm. */
function Bar({ x, y1, y2, i, width, still }: { x: number; y1: number; y2: number; i: number; width: number; still?: boolean }) {
  const reduced = useReducedMotion()
  return (
    <motion.line
      x1={x} x2={x} y1={y1} y2={y2} stroke="currentColor" strokeWidth={width} strokeLinecap="round"
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      animate={still ? undefined : reduced ? { opacity: [1, 0.35, 1] } : { scaleY: [1, 0.3, 1.1, 0.55, 1] }}
      transition={{ duration: reduced ? 1.4 : 0.95 + i * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.11 }}
    />
  )
}

/** The mark's waveform on its own: three bars in a square. Takes the text colour. */
export function Loader({ size = 16, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex shrink-0', className)}>
      <svg viewBox="25.5 22.5 11.7 14.6" width={size} height={size} aria-hidden>
        {MARK.bars.map(([x, a, b], i) => <Bar key={x} x={x} y1={a} y2={b} i={i} width={2.1} />)}
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

/** The aftercall mark drawing itself: the handset rises in, the lens and handle draw, then the
 *  waveform plays until the load is done. */
export function LogoLoader({ size = 44, label = 'Loading', className }: { size?: number; label?: string; className?: string }) {
  const draw = (delay: number) => ({ initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 0.55, ease, delay } })
  return (
    <span role="status" className={cn('inline-flex shrink-0', className)}>
      <svg viewBox="12 12 40 40" width={size} height={size} aria-hidden className="text-primary">
        <motion.path
          d={MARK.handset} fill="var(--primary)"
          style={{ transformBox: 'fill-box', transformOrigin: 'right center' }}
          initial={{ opacity: 0, scale: 0.85, x: 2 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: 0.4, ease }}
        />
        <motion.path d={MARK.lens} fill="none" stroke="var(--foreground)" strokeWidth="4.4" strokeLinecap="round" {...draw(0.12)} />
        <motion.path d={MARK.handle} stroke="var(--foreground)" strokeWidth="5.2" strokeLinecap="round" {...draw(0.45)} />
        {MARK.bars.map(([x, a, b], i) => <Bar key={x} x={x} y1={a} y2={b} i={i} width={1.95} />)}
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** alteria at work: its ring turns (a bright arc runs round it) while the wave inside plays. */
export function AlteriaLoader({ size = 20, label, className }: { size?: number; label?: string; className?: string }) {
  const reduced = useReducedMotion()
  const bars: [number, number][] = [[8.5, 0.55], [12, 1], [15.5, 0.7]]
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex shrink-0', className)}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" opacity={0.25} />
        <motion.circle
          cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength={1} strokeDasharray="0.3 0.7"
          style={{ transformOrigin: '12px 12px' }}
          animate={reduced ? { opacity: [1, 0.4, 1] } : { rotate: 360 }}
          transition={{ duration: reduced ? 1.4 : 1.1, repeat: Infinity, ease: 'linear' }}
        />
        {bars.map(([x, h], i) => <Bar key={x} x={x} y1={12 - 4 * h} y2={12 + 4 * h} i={i} width={2} />)}
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

/** A page's loading state: just the logo loader, centred, after a short wait so quick loads don't
 *  flash. `label` is for screen readers only. */
export function PageLoader({ label = 'Loading', full, className }: { label?: string; full?: boolean; className?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShown(true), 300)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className={cn('grid place-items-center', full ? 'min-h-dvh' : 'min-h-[50vh]', className)} aria-busy="true">
      {shown && (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease }}>
          <LogoLoader label={label} />
        </motion.div>
      )}
    </div>
  )
}

/** A cobalt bar across the top while the router loads the next page's code. Shows after 150 ms. */
export function RouteProgress() {
  const loading = useNavigation().state === 'loading'
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!loading) return setShown(false)
    const id = setTimeout(() => setShown(true), 150)
    return () => clearTimeout(id)
  }, [loading])
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="progress" role="progressbar" aria-label="Loading the page"
          className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary"
          initial={{ scaleX: 0 }} animate={{ scaleX: 0.85, transition: { duration: 2.5, ease: [0.1, 0.6, 0.3, 1] } }}
          exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.2 } }}
        />
      )}
    </AnimatePresence>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// The collection: pick by how long the wait is and what's coming (NN/g response-time limits).
//   under ~0.3 s   nothing. useLoaderVisible keeps anything from flashing.
//   0.3 to 2 s     a skeleton shaped like the content (Skeleton*, ChartLoader), or Loader in a button.
//   2 to 10 s      AlteriaLoader / ChatReplyLoader with ThinkingSteps (say what's happening).
//   over 10 s      ProgressLoader: percent, time left, and "you can leave, we'll notify you".
//   refetching     Refreshing: keep the old content, dimmed, with a small Loader.
//   app / route    BootLoader (first load, sign-in), RouteProgress (next page's code), PageLoader.
// See it all at /dev/loaders (mock builds).
// ════════════════════════════════════════════════════════════════════════════════

/** Whether to show a loader: only once loading has lasted `delay` ms, then for at least `min` ms,
 *  so quick loads show nothing and slow ones don't flicker off the moment they appear. */
export function useLoaderVisible(loading: boolean, { delay = 250, min = 450 } = {}) {
  const [shown, setShown] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    if (loading) {
      const id = setTimeout(() => ((since.current = Date.now()), setShown(true)), delay)
      return () => clearTimeout(id)
    }
    if (!shown) return
    const left = Math.max(0, min - (Date.now() - since.current))
    const id = setTimeout(() => setShown(false), left)
    return () => clearTimeout(id)
  }, [loading, delay, min, shown])
  return shown
}

/** The base block: a low-contrast shimmer (index.css .skeleton). */
export const Skeleton = ({ className }: { className?: string }) => <span aria-hidden className={cn('skeleton block', className)} />

/** Lines of text; the last one shorter, like a paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={cn('block space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />)}
    </span>
  )
}

/** A row of number tiles (Insights, Usage, Overview). */
export function SkeletonKpis({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface space-y-3 px-5 py-4"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-28" /><Skeleton className="h-2.5 w-24" /></div>
      ))}
    </div>
  )
}

/** A card with a title and a few lines. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('surface space-y-3 p-5', className)}>
      <Skeleton className="h-4 w-1/3" /><SkeletonText lines={3} />
    </div>
  )
}

/** A table: header and rows (Results, Usage by person, invoices). */
export function SkeletonTable({ rows = 6, cols = 5, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('surface overflow-hidden', className)}>
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">{Array.from({ length: cols }, (_, j) => <Skeleton key={j} className="h-3 flex-1" />)}</div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0" style={{ opacity: 1 - i * 0.1 }}>
          {Array.from({ length: cols }, (_, j) => <Skeleton key={j} className={cn('h-3', j === 0 ? 'flex-[1.6]' : 'flex-1')} />)}
        </div>
      ))}
    </div>
  )
}

/** A list with avatars or icons (chats, notifications, team). */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('space-y-1', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2" style={{ opacity: 1 - i * 0.12 }}>
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <span className="flex-1 space-y-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></span>
        </div>
      ))}
    </div>
  )
}

/** A dashboard or Insights chart while its numbers load: the chart's shape, bars rising softly. */
export function ChartLoader({ kind = 'bar', className }: { kind?: 'bar' | 'line' | 'number'; className?: string }) {
  const reduced = useReducedMotion()
  if (kind === 'number') {
    return <div role="status" aria-label="Loading the chart" className={cn('flex h-full flex-col justify-center gap-3 p-2', className)}><Skeleton className="h-9 w-32 max-w-full" /><Skeleton className="h-3 w-44 max-w-full" /></div>
  }
  const bars = [0.55, 0.8, 0.4, 0.95, 0.65, 0.3, 0.75]
  return (
    <div role="status" aria-label="Loading the chart" className={cn('relative flex h-full items-end gap-1.5 overflow-hidden rounded-lg px-1 pb-1', className)}>
      {kind === 'bar' ? bars.map((h, i) => (
        <motion.span
          key={i} className="skeleton block min-w-2 flex-1 rounded-md" style={{ height: `${h * 100}%`, transformOrigin: 'bottom' }}
          animate={reduced ? undefined : { scaleY: [1, 0.82, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }}
        />
      )) : (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <motion.path d="M0 30 L15 24 L30 27 L45 15 L60 19 L75 9 L100 13" fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.3} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }} animate={reduced ? { pathLength: 1 } : { pathLength: [0, 1, 1] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
        </svg>
      )}
    </div>
  )
}

/** Say what a slow, multi-step job is doing: the steps turn over every `every` ms, shimmering. */
export function ThinkingSteps({ steps, every = 1800, className }: { steps: string[]; every?: number; className?: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(steps.length - 1, x + 1)), every)
    return () => clearInterval(id)
  }, [steps.length, every])
  return (
    <span role="status" aria-live="polite" className={cn('relative block h-5 overflow-hidden', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={i} className="shimmer-text absolute inset-x-0 text-sm font-medium" initial={{ y: 12, opacity: 0, filter: 'blur(2px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.3, ease }}>
          {steps[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** alteria working on an answer (Ask alteria, drafts): its mark, what it's doing, where text will go. */
export function ChatReplyLoader({ steps = ['Reading your conversations…', 'Counting the answers…', 'Drawing the chart…', 'Writing it up…'], className }: { steps?: string[]; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      <ThinkingSteps steps={steps} />
      <SkeletonText lines={2} className="max-w-md opacity-70" />
    </div>
  )
}

/** Over ~10 s: how far, how long, and that it's fine to leave. Without `value` it's indeterminate. */
export function ProgressLoader({ value, label, eta, note, className }: { value?: number; label: string; eta?: string; note?: string; className?: string }) {
  const reduced = useReducedMotion()
  const pctDone = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className={cn('space-y-2', className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctDone}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{pctDone !== undefined && `${pctDone}%`}{eta && ` · ${eta}`}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {pctDone !== undefined ? (
          <motion.span className="absolute inset-y-0 left-0 rounded-full bg-primary" initial={false} animate={{ width: `${pctDone}%` }} transition={{ duration: 0.4, ease }} />
        ) : (
          <motion.span className="absolute inset-y-0 w-1/3 rounded-full bg-primary" animate={reduced ? { opacity: [0.4, 1, 0.4] } : { x: ['-100%', '300%'] }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }} />
        )}
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Refetching what's already on screen: keep it, dim it, and show a small loader in the corner. */
export function Refreshing({ loading, children, className }: { loading: boolean; children: React.ReactNode; className?: string }) {
  const shown = useLoaderVisible(loading, { delay: 200, min: 300 })
  return (
    <div className={cn('relative', className)} aria-busy={loading}>
      <div className={cn('transition-opacity duration-200', shown && 'pointer-events-none opacity-55')}>{children}</div>
      <AnimatePresence>
        {shown && (
          <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute top-2 right-2 grid size-7 place-items-center rounded-full border bg-card shadow-panel">
            <Loader size={14} className="text-primary" label="Updating" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The first load of the app, and signing in: the logo, full screen, no text. */
export const BootLoader = () => <PageLoader full />

/** When to use which, for the /dev/loaders gallery and for picking one. */
export const LOADERS: { name: string; when: string; wait: string }[] = [
  { name: 'Nothing (useLoaderVisible)', when: 'Anything that usually finishes in under 0.3 s: toggles, saves, cached pages', wait: '< 0.3 s' },
  { name: 'Loader', when: 'Inside a button or next to a word while one action runs', wait: '0.3 to 3 s' },
  { name: 'SkeletonText / SkeletonCard / SkeletonKpis', when: 'A page or panel whose layout you know: settings, overview, KPI rows', wait: '0.3 to 3 s' },
  { name: 'SkeletonTable / SkeletonList', when: 'Results, usage by person, chats, notifications, team', wait: '0.3 to 3 s' },
  { name: 'ChartLoader', when: 'A dashboard or Insights chart while its numbers load', wait: '0.3 to 5 s' },
  { name: 'Refreshing', when: 'Re-fetching content that’s already shown (a filter or range changed)', wait: '0.3 to 5 s' },
  { name: 'AlteriaLoader', when: 'alteria is busy: its buttons, its avatar in a chat', wait: '1 to 10 s' },
  { name: 'ChatReplyLoader / ThinkingSteps', when: 'An AI answer or draft: say what it’s doing, step by step', wait: '2 to 20 s' },
  { name: 'ProgressLoader', when: 'Uploads, runs over many conversations, exports: percent and time left', wait: '> 10 s' },
  { name: 'RouteProgress', when: 'The next page’s code is loading (top of the window)', wait: '0.15 s +' },
  { name: 'PageLoader', when: 'A whole page with no known layout yet', wait: '0.3 s +' },
  { name: 'LogoLoader / BootLoader', when: 'The app starting, signing in, a link being verified', wait: '0.3 s +' },
]
