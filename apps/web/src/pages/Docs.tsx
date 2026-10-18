// /docs: the help centre, public so it can be found and linked. The landing page is a search box
// and a grid of sections; an article has the section nav on the left, the article, and "On this
// page" on the right (the Stripe and Linear pattern). Content is in src/docs/.
import { ArrowLeft, ArrowRight, CaretRight, List as ListIcon, MagnifyingGlass, Warning } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Wordmark } from '../brand'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../components/ui/sheet'
import { ARTICLES, articleBySlug, articlesIn, SECTIONS, sectionOf, type Article } from '../docs/registry'
import { searchDocs, warmDocSearch, type DocHit } from '../docs/search'
import { Continue, Helpful, rememberArticle } from '../docs/feedback'
import { Loader } from '../loaders'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { useMe } from '../people'
import { useTheme } from '../theme'
import { ThemeButton } from '../ui'
import { toasterProps } from '../lib/toast'

export function DocsShell({ children, crumb }: { children: ReactNode; crumb?: ReactNode }) {
  const me = useMe().data
  const theme = useTheme()
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-6">
          <Link to="/" className="rounded-lg py-1" aria-label="aftercall home"><Wordmark /></Link>
          <span className="text-muted-foreground" aria-hidden>/</span>
          <Link to="/docs" className="text-sm font-medium">Docs</Link>
          {crumb && <><span className="text-muted-foreground" aria-hidden>/</span>{crumb}</>}
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link to="/docs/support" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:block">Support</Link>
            <ThemeButton />
            <Button size="sm" asChild className="ml-1"><Link to={me ? '/insights' : '/login'}>{me ? 'Open the app' : 'Sign in'}</Link></Button>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted-foreground md:px-6">
          <span>© {new Date().getFullYear()} aftercall</span>
          {['privacy', 'terms', 'security', 'cookies', 'support'].map((s) => <Link key={s} to={`/docs/${s}`} className="hover:text-foreground">{articleBySlug(s)!.title.replace(' policy', '').replace('Contact support', 'Support')}</Link>)}
        </div>
      </footer>
      <Toaster {...toasterProps(dark)} />
    </div>
  )
}

// ── Search ─────────────────────────────────────────────────────────────────────

/** "‹word›" marks from the index → <mark>. */
const Snippet = ({ text }: { text: string }) => (
  <>{text.split(/(‹[^›]*›)/).map((part, i) => part.startsWith('‹') ? <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">{part.slice(1, -1)}</mark> : part)}</>
)

/** `inline`: the results open in the page flow instead of floating, for places that scroll or trap
 *  focus (the phone menu's sheet), where a floating panel would be cut off. */
export function DocSearch({ autoFocus, compact, inline, className }: { autoFocus?: boolean; compact?: boolean; inline?: boolean; className?: string }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<DocHit[]>()
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, '')
  const navigate = useNavigate()
  // Keep the highlighted result in view as the arrow keys move it.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`#${uid}-hit-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, uid])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea')) (e.preventDefault(), ref.current?.focus())
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!q.trim()) return setHits(undefined)
    let live = true
    setBusy(true)
    const id = setTimeout(() => void searchDocs(q).then((h) => live && (setHits(h), setActive(0), setBusy(false))), 120)
    return () => ((live = false), clearTimeout(id))
  }, [q])
  const go = (h: DocHit) => {
    setQ('')
    navigate(`/docs/${h.slug}${h.anchor ? `#${h.anchor}` : ''}`)
  }
  // Group by article, keeping the best-first order of the articles' first hits.
  const groups = hits ? [...new Map(hits.map((h) => [h.slug, hits.filter((x) => x.slug === h.slug)])).values()] : []
  const flat = groups.flat()

  return (
    <div className={cn('relative', className)}>
      <MagnifyingGlass size={compact ? 15 : 18} className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', compact ? 'left-2.5' : 'left-3.5')} aria-hidden />
      <Input
        ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onFocus={warmDocSearch} autoFocus={autoFocus} placeholder={compact ? 'Search' : 'Search the docs, or ask a question'}
        onKeyDown={(e) => {
          // Arrows wrap round; Home and End jump. The mouse only takes over when it actually moves.
          if (!flat.length) return
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => (a + 1) % flat.length))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => (a - 1 + flat.length) % flat.length))
          else if (e.key === 'Home' && e.ctrlKey) (e.preventDefault(), setActive(0))
          else if (e.key === 'End' && e.ctrlKey) (e.preventDefault(), setActive(flat.length - 1))
          else if (e.key === 'Enter' && flat[active]) (e.preventDefault(), go(flat[active]))
          else if (e.key === 'Escape') setQ('')
        }}
        className={cn('bg-card shadow-panel', compact ? 'h-9 rounded-lg pr-8 pl-8 text-sm' : 'h-12 rounded-xl pr-12 pl-11 text-base')}
        aria-label="Search the docs" role="combobox" aria-expanded={!!hits} aria-controls={`${uid}-hits`} aria-activedescendant={flat[active] ? `${uid}-hit-${active}` : undefined} aria-autocomplete="list"
      />
      <span className={cn('absolute top-1/2 -translate-y-1/2', compact ? 'right-2.5' : 'right-3.5')}>
        {busy ? <Loader size={14} className="text-muted-foreground" label="Searching" /> : <kbd className="pointer-events-none rounded border bg-muted px-1.5 text-xs text-muted-foreground">/</kbd>}
      </span>
      <AnimatePresence>
        {hits && (
          <motion.div
            ref={list} id={`${uid}-hits`} role="listbox" initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease }}
            className={cn('z-40 mt-2 max-h-[min(28rem,70dvh)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-left shadow-float', inline ? 'relative' : 'absolute top-full', !inline && (compact ? 'left-0 w-[min(28rem,calc(100vw-2rem))]' : 'inset-x-0'))}
          >
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{q.trim()}”. Try other words, or <Link to="/docs/support" className="font-medium text-primary hover:underline">ask us</Link>.</p>
            ) : groups.map((g) => (
              <div key={g[0].slug} className="py-1">
                <p className="px-3 pt-1 pb-1 text-xs font-medium text-muted-foreground">{g[0].section} › {g[0].article}</p>
                {g.map((h) => {
                  const i = flat.indexOf(h)
                  return (
                    <Link
                      key={h.id} id={`${uid}-hit-${i}`} role="option" aria-selected={i === active} to={`/docs/${h.slug}${h.anchor ? `#${h.anchor}` : ''}`} onClick={() => setQ('')}
                      onMouseMove={() => i !== active && setActive(i)}
                      className={cn('relative block scroll-my-2 rounded-lg px-3 py-2 transition-colors duration-100', i === active ? 'bg-primary-soft' : 'hover:bg-muted/60')}
                    >
                      {i === active && <span className="absolute inset-y-2 left-0.5 w-0.5 rounded-full bg-primary" aria-hidden />}
                      <span className="flex items-center gap-1.5 text-sm font-medium">{h.heading ?? h.article}{h.heading && <span className="text-xs font-normal text-muted-foreground">#</span>}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-ink-2"><Snippet text={h.snippet} /></span>
                    </Link>
                  )
                })}
              </div>
            ))}
            {flat.length > 0 && <p className="border-t px-3 pt-2 pb-1 text-[0.6875rem] text-muted-foreground">↑↓ to move · Enter to open · Esc to close</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Landing ────────────────────────────────────────────────────────────────────

export default function DocsHome() {
  useEffect(() => void (document.title = 'Docs · aftercall'), [])
  return (
    <DocsShell>
      <section className="relative border-b">
        <div className="dot-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-3xl px-4 pt-14 pb-12 text-center md:pt-20">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">How can we help?</h1>
          <p className="mt-3 text-lg text-ink-2">Guides, answers and policies for aftercall.</p>
          <DocSearch autoFocus className="mx-auto mt-8 max-w-xl" />
          <p className="mt-4 text-sm text-muted-foreground">
            Popular: {['first-analysis', 'glossary', 'trackers-and-signals', 'credits'].map((s, i) => (
              <span key={s}>{i > 0 && ' · '}<Link to={`/docs/${s}`} className="text-foreground hover:text-primary">{articleBySlug(s)!.title}</Link></span>
            ))}
          </p>
          <Continue />
        </div>
      </section>
      <main className="mx-auto max-w-7xl px-4 py-12 md:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map(({ id, title, description, Icon }, i) => {
            const items = articlesIn(id)
            return (
              <motion.li key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: i * 0.035 }}>
                <div className="surface group flex h-full flex-col p-5 transition-[border-color,box-shadow] duration-200 hover:border-primary/35 hover:shadow-float">
                  <Link to={`/docs/${items[0].slug}`} className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary transition-transform duration-200 group-hover:scale-105"><Icon size={20} weight="duotone" aria-hidden /></span>
                    <h2 className="font-semibold tracking-tight">{title}</h2>
                  </Link>
                  <p className="mt-2 text-sm text-ink-2">{description}</p>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {items.slice(0, 4).map((x) => (
                      <li key={x.slug}><Link to={`/docs/${x.slug}`} className="text-muted-foreground hover:text-primary">{x.title}</Link></li>
                    ))}
                    {items.length > 4 && <li><Link to={`/docs/${items[4].slug}`} className="text-xs font-medium text-primary">+{items.length - 4} more</Link></li>}
                  </ul>
                </div>
              </motion.li>
            )
          })}
        </ul>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 rounded-2xl border bg-card px-6 py-6 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-semibold">Can’t find it?</p>
            <p className="text-sm text-ink-2">Real people answer, usually within a business day.</p>
          </div>
          <Button asChild><Link to="/docs/support">Contact support</Link></Button>
        </div>
      </main>
    </DocsShell>
  )
}

// ── Article ────────────────────────────────────────────────────────────────────

function SideNav({ active, onPick }: { active: string; onPick?: () => void }) {
  return (
    <nav aria-label="Docs" className="space-y-6 text-sm">
      {SECTIONS.map((s) => (
        <div key={s.id}>
          <p className="mb-1.5 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.title}</p>
          <ul className="space-y-0.5">
            {articlesIn(s.id).map((x) => (
              <li key={x.slug}>
                <NavLink to={`/docs/${x.slug}`} onClick={onPick} className={cn('relative isolate block rounded-md px-2 py-1.5 transition-colors', x.slug === active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {x.slug === active && <motion.span layoutId="doc-nav" className="absolute inset-0 -z-10 rounded-md bg-muted" transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.12 }} />}
                  {x.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** "On this page": the article's headings (their clean titles), the one in view highlighted.
 *  Articles load lazily, so it watches the article and collects headings as they appear. */
export function OnThisPage({ slug }: { slug: string }) {
  const [heads, setHeads] = useState<{ id: string; text: string }[]>([])
  const [current, setCurrent] = useState<string>()
  useEffect(() => {
    const article = document.querySelector('article')
    if (!article) return
    let io: IntersectionObserver | undefined
    const collect = () => {
      const hs = [...article.querySelectorAll<HTMLHeadingElement>('h2[id]')]
      setHeads(hs.map((h) => ({ id: h.id, text: h.dataset.toc ?? h.textContent ?? '' })))
      io?.disconnect()
      io = new IntersectionObserver((es) => {
        const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (v) setCurrent(v.target.id)
      }, { rootMargin: '-80px 0px -65% 0px' })
      hs.forEach((h) => io!.observe(h))
    }
    collect()
    const mo = new MutationObserver(collect)
    mo.observe(article, { childList: true, subtree: true })
    return () => (mo.disconnect(), io?.disconnect())
  }, [slug])
  if (heads.length < 2) return null
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
      <ul className="space-y-1.5 border-l">
        {heads.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className={cn('-ml-px block border-l py-0.5 pl-3 transition-colors', current === h.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** A link to #heading scrolls there once the lazy article has drawn it. */
export function useScrollToHash(slug: string, hash: string) {
  useEffect(() => {
    if (!hash) return void window.scrollTo({ top: 0 })
    const id = decodeURIComponent(hash.slice(1))
    const tryScroll = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ block: 'start' })
      return !!el
    }
    if (tryScroll()) return
    const mo = new MutationObserver(() => tryScroll() && mo.disconnect())
    mo.observe(document.body, { childList: true, subtree: true })
    const stop = setTimeout(() => mo.disconnect(), 4000)
    return () => (mo.disconnect(), clearTimeout(stop))
  }, [slug, hash])
}

export function DocsArticle() {
  const { slug } = useParams()
  const { hash } = useLocation()
  const [menu, setMenu] = useState(false)
  const x = articleBySlug(slug)
  useEffect(() => {
    if (x) document.title = `${x.title} · aftercall docs`
    if (x) rememberArticle(x.slug)
  }, [x])
  useScrollToHash(slug ?? '', hash)
  if (!x) return <Navigate to="/docs" replace />
  const i = ARTICLES.indexOf(x)
  const prev: Article | undefined = ARTICLES[i - 1]
  const next: Article | undefined = ARTICLES[i + 1]
  const section = sectionOf(x.section)

  return (
    <DocsShell>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 md:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_12rem]">
        {/* The search sits outside the nav's scroll box, so its results float over the page instead of being cut off. */}
        <aside className="sticky top-14 z-20 hidden h-[calc(100dvh-3.5rem)] flex-col py-8 lg:flex">
          <DocSearch compact className="mb-6 mr-2" />
          <div className="-ml-1 min-h-0 flex-1 overflow-y-auto pr-2 pl-1"><SideNav active={x.slug} /></div>
        </aside>
        <main className="min-w-0 py-8 md:py-10">
          <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Sheet open={menu} onOpenChange={setMenu}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="lg:hidden"><ListIcon aria-hidden /> Menu</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85%] max-w-80 overflow-y-auto px-3 pt-14">
                <SheetTitle className="sr-only">Docs</SheetTitle>
                <DocSearch compact inline className="mb-5" />
                <SideNav active={x.slug} onPick={() => setMenu(false)} />
              </SheetContent>
            </Sheet>
            <Link to="/docs" className="hover:text-foreground">Docs</Link>
            <CaretRight size={11} aria-hidden />
            <span>{section.title}</span>
          </div>
          <motion.article key={x.slug} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className="max-w-[72ch]">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-balance">{x.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Updated {new Date(x.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {x.draft && (
              <p className="mt-5 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-ink-2">
                <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <span><b className="font-semibold text-foreground">Draft.</b> This page hasn’t had legal review yet, and parts in [brackets] are still to be filled in.</span>
              </p>
            )}
            <div className="mt-8">
              <Suspense fallback={<div className="grid h-40 place-items-center"><Loader size={20} className="text-primary" label="Loading the article" /></div>}>
                <x.Body />
              </Suspense>
            </div>
          </motion.article>
          <div className="mt-14 grid max-w-[72ch] gap-3 border-t pt-6 sm:grid-cols-2">
            {prev ? (
              <Link to={`/docs/${prev.slug}`} className="group rounded-xl border px-4 py-3 transition-colors hover:border-primary/40">
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={12} aria-hidden /> Previous</span>
                <span className="mt-0.5 block font-medium group-hover:text-primary">{prev.title}</span>
              </Link>
            ) : <span />}
            {next && (
              <Link to={`/docs/${next.slug}`} className="group rounded-xl border px-4 py-3 text-right transition-colors hover:border-primary/40">
                <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">Next <ArrowRight size={12} aria-hidden /></span>
                <span className="mt-0.5 block font-medium group-hover:text-primary">{next.title}</span>
              </Link>
            )}
          </div>
          <Helpful slug={x.slug} />
          <p className="mt-6 max-w-[72ch] text-sm text-muted-foreground">Still stuck? <Link to="/docs/support" className="font-medium text-primary hover:underline">Contact support</Link>.</p>
        </main>
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto py-10 xl:block">
          <OnThisPage slug={x.slug} />
        </aside>
      </div>
    </DocsShell>
  )
}
