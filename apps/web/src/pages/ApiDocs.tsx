// /docs/api: the API and integrations docs. Its own site inside the docs, with its own side nav (the
// help centre's articles aren't in it), the Stripe and Twilio pattern: nav on the left, the page,
// and "On this page" on the right; reference pages go two columns wide instead. The help centre
// lists it as a card in its grid and a link in its nav. Content is in src/docs/api/.
import { ArrowLeft, ArrowRight, CaretRight, Check, Copy, Flask, List as ListIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, useLocation, useParams } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../components/ui/sheet'
import { API_GROUPS, API_PAGES, apiGroupOf, apiPageBySlug, apiPagesIn, isWide, type ApiPage } from '../docs/api/registry'
import { API, VERSION } from '../docs/api/guides'
import { Sample } from '../docs/api/kit'
import { Loader } from '../loaders'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { DocSearch, DocsShell, OnThisPage, useScrollToHash } from './Docs'

// ── Nav ────────────────────────────────────────────────────────────────────────

function ApiNav({ active, onPick }: { active?: string; onPick?: () => void }) {
  const item = (to: string, label: string, on: boolean) => (
    <NavLink to={to} end onClick={onPick} className={cn('relative isolate block rounded-md px-2 py-1.5 transition-colors', on ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
      {on && <motion.span layoutId="api-nav" className="absolute inset-0 -z-10 rounded-md bg-muted" transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.12 }} />}
      {label}
    </NavLink>
  )
  return (
    <nav aria-label="API docs" className="space-y-6 text-sm">
      <ul>{<li>{item('/docs/api', 'Overview', !active)}</li>}</ul>
      {API_GROUPS.map((g) => (
        <div key={g.id}>
          <p className="mb-1.5 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</p>
          <ul className="space-y-0.5">
            {apiPagesIn(g.id).map((x) => <li key={x.slug}>{item(`/docs/api/${x.slug}`, x.nav ?? x.title, x.slug === active)}</li>)}
          </ul>
        </div>
      ))}
      <Link to="/docs" onClick={onPick} className="flex items-center gap-1.5 border-t px-2 pt-4 text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={13} aria-hidden /> Help centre
      </Link>
    </nav>
  )
}

/** The version and the preview state, above the nav. */
const VersionChip = () => (
  <p className="mb-4 flex items-center gap-2 px-2 text-xs text-muted-foreground">
    <span className="rounded-[6px] bg-warn-soft px-1.5 py-0.5 font-medium text-warn">Preview</span>
    <span className="font-mono">{VERSION}</span>
  </p>
)

function Layout({ active, wide, crumb, children }: { active?: string; wide?: boolean; crumb?: ReactNode; children: ReactNode }) {
  const [menu, setMenu] = useState(false)
  return (
    <DocsShell crumb={<Link to="/docs/api" className="text-sm font-medium">API</Link>}>
      <div className={cn('mx-auto grid max-w-7xl gap-10 px-4 md:px-6 lg:grid-cols-[15rem_minmax(0,1fr)]', !wide && 'xl:grid-cols-[15rem_minmax(0,1fr)_12rem]')}>
        {/* The search sits outside the nav's scroll box, so its results float over the page. */}
        <aside className="sticky top-14 z-20 hidden h-[calc(100dvh-3.5rem)] flex-col py-8 lg:flex">
          <DocSearch compact className="mr-2 mb-5" />
          <div className="-ml-1 min-h-0 flex-1 overflow-y-auto pr-2 pb-6 pl-1">
            <VersionChip />
            <ApiNav active={active} />
          </div>
        </aside>
        <main className="min-w-0 py-8 md:py-10">
          <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Sheet open={menu} onOpenChange={setMenu}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="lg:hidden"><ListIcon aria-hidden /> Menu</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85%] max-w-80 overflow-y-auto px-3 pt-14">
                <SheetTitle className="sr-only">API docs</SheetTitle>
                <DocSearch compact inline className="mb-5" />
                <VersionChip />
                <ApiNav active={active} onPick={() => setMenu(false)} />
              </SheetContent>
            </Sheet>
            <Link to="/docs" className="hover:text-foreground">Docs</Link>
            <CaretRight size={11} aria-hidden />
            <Link to="/docs/api" className="hover:text-foreground">API</Link>
            {crumb && <><CaretRight size={11} aria-hidden /><span>{crumb}</span></>}
          </div>
          {children}
        </main>
        {!wide && (
          <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto py-10 xl:block">
            <OnThisPage slug={active ?? ''} />
          </aside>
        )}
      </div>
    </DocsShell>
  )
}

/** Until B59 ships, every page says so, so nobody builds against an endpoint that isn't live. */
const PreviewNotice = () => (
  <p className="mb-8 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm leading-6 text-ink-2">
    <Flask size={17} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
    <span><b className="font-semibold text-foreground">Preview: available soon.</b> The API is being built. This is the design it’s being built to, so names and fields may still change before it opens. <Link to="/docs/api/changelog" className="font-medium text-primary hover:underline">Follow the changelog</Link>.</span>
  </p>
)

/** Copies the page as text with its address, ready to paste into an AI chat. */
function CopyForAi({ title }: { title: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(t)
  }, [done])
  const copy = async () => {
    const body = document.querySelector('article')?.innerText ?? ''
    await navigator.clipboard.writeText(`# ${title}\n\nSource: ${location.origin}${location.pathname}\n\n${body}`)
    setDone(true)
  }
  return (
    <Button variant="outline" size="sm" onClick={copy} className="w-32 shrink-0" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(done)} className="flex items-center gap-1.5" initial={{ opacity: 0, scale: 0.8, filter: 'blur(2px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
          {done ? <><Check weight="bold" className="text-ok" aria-hidden /> Copied</> : <><Copy aria-hidden /> Copy for AI</>}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}

// ── Landing ────────────────────────────────────────────────────────────────────

export default function ApiDocsHome() {
  const { hash } = useLocation()
  useEffect(() => void (document.title = 'API and integrations · aftercall docs'), [])
  useScrollToHash('', hash)
  return (
    <Layout>
      <PreviewNotice />
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}>
        <p className="text-sm font-medium text-primary">API and integrations</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-[-0.04em] text-balance">Build on aftercall</h1>
        <p className="mt-3 max-w-[62ch] text-lg leading-8 text-ink-2 text-pretty">
          Send every call and chat to aftercall as it ends, get the answers back where your team works, and let any AI ask questions of your conversations. One REST API, signed webhooks, and connectors for the platforms you already use.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild><Link to="/docs/api/quickstart">Quickstart <ArrowRight aria-hidden /></Link></Button>
          <Button variant="outline" asChild><Link to="/docs/api/connectors">Browse connectors</Link></Button>
          <Button variant="ghost" asChild><Link to="/docs/api/reference-conversations">API reference</Link></Button>
        </div>
      </motion.div>

      <div className="mt-10 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] 2xl:items-center">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Push a conversation in one request</h2>
          <p className="mt-2 leading-7 text-ink-2">The transcript pusher takes a transcript in any layout, stores it at once, and analyses it with your trackers. A webhook tells you when the answers are ready.</p>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
            {['Test keys that cost nothing', 'Safe retries with idempotency keys', 'Nothing lost when credits run low', 'Python and TypeScript SDKs'].map((x) => (
              <li key={x} className="flex items-center gap-2"><Check size={14} weight="bold" className="text-ok" aria-hidden />{x}</li>
            ))}
          </ul>
        </div>
        <Sample className="my-0" samples={{
          curl: `
curl ${API}/conversations \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -d project=front-desk \\
  -d external_id=CA8f2e91c4 \\
  --data-urlencode "transcript=Agent: Sunrise Clinic…"`,
          python: `
client.conversations.create(
    project="front-desk",
    external_id="CA8f2e91c4",
    transcript="Agent: Sunrise Clinic…",
)`,
          node: `
await client.conversations.create({
  project: 'front-desk',
  external_id: 'CA8f2e91c4',
  transcript: 'Agent: Sunrise Clinic…',
})`,
        }} />
      </div>

      <h2 className="mt-14 mb-4 text-xl font-semibold tracking-tight">Explore the docs</h2>
      <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {API_GROUPS.map(({ id, title, description, Icon }, i) => {
          const items = apiPagesIn(id)
          return (
            <motion.li key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: i * 0.035 }}>
              <div className="surface group flex h-full flex-col p-5 transition-[border-color,box-shadow] duration-200 hover:border-primary/35 hover:shadow-float">
                <Link to={`/docs/api/${items[0].slug}`} className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary transition-transform duration-200 group-hover:scale-105"><Icon size={20} weight="duotone" aria-hidden /></span>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                </Link>
                <p className="mt-2 text-sm text-ink-2">{description}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {items.slice(0, 4).map((x) => <li key={x.slug}><Link to={`/docs/api/${x.slug}`} className="text-muted-foreground hover:text-primary">{x.nav ?? x.title}</Link></li>)}
                  {items.length > 4 && <li><Link to={`/docs/api/${items[4].slug}`} className="text-xs font-medium text-primary">+{items.length - 4} more</Link></li>}
                </ul>
              </div>
            </motion.li>
          )
        })}
      </ul>

      <div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl border bg-card px-6 py-6 sm:flex-row sm:items-center">
        <div>
          <p className="font-semibold">Want early access?</p>
          <p className="text-sm text-ink-2">Tell us what you’d connect first. We build the most-asked connectors first.</p>
        </div>
        <Button variant="outline" asChild><Link to="/docs/support">Contact us</Link></Button>
      </div>
    </Layout>
  )
}

// ── A page ─────────────────────────────────────────────────────────────────────

export function ApiDocsPage() {
  const { slug } = useParams()
  const { hash } = useLocation()
  const x = apiPageBySlug(slug)
  useEffect(() => {
    if (x) document.title = `${x.title} · aftercall API`
  }, [x])
  useScrollToHash(slug ?? '', hash)
  if (!x) return <Navigate to="/docs/api" replace />
  const i = API_PAGES.indexOf(x)
  const prev: ApiPage | undefined = API_PAGES[i - 1]
  const next: ApiPage | undefined = API_PAGES[i + 1]
  const wide = isWide(x)
  const measure = wide ? 'max-w-none' : 'max-w-[72ch]'

  return (
    <Layout active={x.slug} wide={wide} crumb={apiGroupOf(x.group).title}>
      <PreviewNotice />
      <motion.article key={x.slug} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className={measure}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-balance">{x.title}</h1>
          <CopyForAi title={x.title} />
        </div>
        <div className="mt-6">
          <Suspense fallback={<div className="grid h-40 place-items-center"><Loader size={20} className="text-primary" label="Loading the page" /></div>}>
            <x.Body />
          </Suspense>
        </div>
      </motion.article>
      <div className={cn('mt-14 grid gap-3 border-t pt-6 sm:grid-cols-2', measure)}>
        {prev ? (
          <Link to={`/docs/api/${prev.slug}`} className="group rounded-xl border px-4 py-3 transition-colors hover:border-primary/40">
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={12} aria-hidden /> Previous</span>
            <span className="mt-0.5 block font-medium group-hover:text-primary">{prev.title}</span>
          </Link>
        ) : <span />}
        {next && (
          <Link to={`/docs/api/${next.slug}`} className="group rounded-xl border px-4 py-3 text-right transition-colors hover:border-primary/40">
            <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">Next <ArrowRight size={12} aria-hidden /></span>
            <span className="mt-0.5 block font-medium group-hover:text-primary">{next.title}</span>
          </Link>
        )}
      </div>
      <p className={cn('mt-6 text-sm text-muted-foreground', measure)}>Something unclear or missing? <Link to="/docs/support" className="font-medium text-primary hover:underline">Tell us</Link>.</p>
    </Layout>
  )
}
