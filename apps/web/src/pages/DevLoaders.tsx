// /dev/loaders: every loader in loaders.tsx, running, with when to use it. Mock builds only.
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/button'
import {
  AlteriaLoader, ChartLoader, ChatReplyLoader, Loader, LOADERS, LogoLoader, ProgressLoader, Refreshing, SkeletonCard, SkeletonKpis,
  SkeletonList, SkeletonTable, SkeletonText, ThinkingSteps, useLoaderVisible,
} from '../loaders'

function Tile({ name, wait, children, wide }: { name: string; wait: string; children: ReactNode; wide?: boolean }) {
  // Exact names only ("Loader" mustn't match "AlteriaLoader" or "useLoaderVisible").
  const when = LOADERS.find((l) => l.name.split(/ \/ |[ ()]+/).includes(name))?.when
  return (
    <section className={wide ? 'md:col-span-2' : undefined} aria-label={name}>
      <div className="surface flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-sm font-medium">{name}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{wait}</span>
        </div>
        {when && <p className="mt-1 text-sm text-ink-2">{when}</p>}
        <div className="mt-5 flex flex-1 items-center justify-center rounded-xl border border-dashed p-5">{children}</div>
      </div>
    </section>
  )
}

/** A loop from 0 to 100% over ~12 s, for the progress demo. */
function useLoop(ms = 12_000) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const id = setInterval(() => setV(((Date.now() - t0) % ms) / ms), 200)
    return () => clearInterval(id)
  }, [ms])
  return v
}

function AntiFlash() {
  const [loading, setLoading] = useState(false)
  const [ms, setMs] = useState(0)
  const shown = useLoaderVisible(loading)
  const run = (d: number) => {
    setMs(d)
    setLoading(true)
    setTimeout(() => setLoading(false), d)
  }
  return (
    <div className="w-full space-y-3 text-center">
      <div className="flex justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => run(150)}>A 0.15 s load</Button>
        <Button size="sm" variant="outline" onClick={() => run(1500)}>A 1.5 s load</Button>
      </div>
      <p className="h-5 text-sm text-muted-foreground">{shown ? <span className="inline-flex items-center gap-2 text-foreground"><Loader className="text-primary" /> Loading…</span> : loading ? `Loading ${ms} ms, nothing shown yet` : 'Idle'}</p>
    </div>
  )
}

export default function DevLoaders() {
  const v = useLoop()
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setRefreshing((r) => !r), 2500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="min-h-dvh px-4 py-10 md:px-8">
      <div className="mx-auto max-w-6xl">
        <a href="/dev/flows" className="text-sm text-muted-foreground hover:text-foreground">← Every flow</a>
        <p className="font-mono text-xs text-muted-foreground uppercase">mock · loaders.tsx</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Every loader</h1>
        <p className="mt-1 max-w-[70ch] text-ink-2">Pick by how long the wait is. Under 0.3 s: nothing. Up to 2 s: a skeleton shaped like what’s coming. 2 to 10 s: say what’s happening. Over 10 s: progress, time left, and that it’s fine to leave.</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Tile name="useLoaderVisible" wait="< 0.3 s"><AntiFlash /></Tile>
          <Tile name="Loader" wait="0.3 to 3 s">
            <div className="flex items-center gap-4"><Button disabled><Loader /> Saving…</Button><Loader size={20} className="text-primary" /></div>
          </Tile>
          <Tile name="AlteriaLoader" wait="1 to 10 s">
            <div className="flex items-center gap-4 text-primary"><AlteriaLoader size={28} /><Button disabled><AlteriaLoader size={16} /> Draft with alteria</Button></div>
          </Tile>

          <Tile name="SkeletonText" wait="0.3 to 3 s"><SkeletonText lines={4} className="w-full" /></Tile>
          <Tile name="SkeletonCard" wait="0.3 to 3 s"><SkeletonCard className="w-full" /></Tile>
          <Tile name="SkeletonList" wait="0.3 to 3 s"><SkeletonList rows={4} className="w-full" /></Tile>

          <Tile name="SkeletonKpis" wait="0.3 to 3 s" wide><SkeletonKpis count={3} className="w-full lg:grid-cols-3" /></Tile>
          <Tile name="ChartLoader" wait="0.3 to 5 s" wide>
            <div className="grid w-full gap-4 sm:grid-cols-3">
              {(['number', 'bar', 'line'] as const).map((k) => (
                <div key={k} className="rounded-lg border bg-card p-3">
                  <p className="mb-2 font-mono text-xs text-muted-foreground">kind="{k}"</p>
                  <ChartLoader kind={k} className="h-36" />
                </div>
              ))}
            </div>
          </Tile>
          <Tile name="PageLoader" wait="0.3 s +">
            <div className="grid h-36 w-full place-items-center rounded-lg bg-background"><LogoLoader size={40} key={Math.floor(v * 3) + 10} /></div>
          </Tile>

          <Tile name="SkeletonTable" wait="0.3 to 3 s" wide><SkeletonTable rows={4} cols={5} className="w-full" /></Tile>
          <Tile name="Refreshing" wait="0.3 to 5 s">
            <Refreshing loading={refreshing} className="w-full">
              <div className="surface space-y-1 p-4 text-sm"><p className="font-medium">Booked</p><p className="text-2xl font-semibold tabular-nums">37%</p><p className="text-muted-foreground">1,300 answers</p></div>
            </Refreshing>
          </Tile>

          <Tile name="ChatReplyLoader" wait="2 to 20 s" wide>
            <div className="flex w-full gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><AlteriaLoader size={18} /></span>
              <ChatReplyLoader className="flex-1" key={Math.floor(v * 2)} />
            </div>
          </Tile>
          <Tile name="ThinkingSteps" wait="2 to 20 s">
            <ThinkingSteps key={Math.floor(v * 2)} steps={['Reading the file…', 'Found 412 conversations', 'Checking the layout…', 'Estimating tokens…']} every={1400} className="w-full text-center" />
          </Tile>

          <Tile name="ProgressLoader" wait="> 10 s" wide>
            <div className="w-full space-y-6">
              <ProgressLoader value={v} label="Analysing 412 conversations" eta={`about ${Math.max(1, Math.round((1 - v) * 12))} s left`} note="You can leave this page. We’ll notify you when it’s done." />
              <ProgressLoader label="Preparing your export" note="Big exports take a minute." />
            </div>
          </Tile>
          <Tile name="LogoLoader" wait="0.3 s +"><LogoLoader size={56} key={Math.floor(v * 3)} /></Tile>

          <Tile name="RouteProgress" wait="0.15 s +">
            <div className="w-full space-y-2 text-center">
              <div className="relative h-8 overflow-hidden rounded-md border bg-background"><span className="absolute inset-x-0 top-0 h-0.5 origin-left bg-primary" style={{ transform: `scaleX(${0.2 + v * 0.7})` }} /></div>
              <p className="text-xs text-muted-foreground">A bar at the very top of the window while the next page loads.</p>
            </div>
          </Tile>
          <Tile name="BootLoader" wait="0.3 s +">
            <div className="grid h-32 w-full place-items-center rounded-lg bg-background"><LogoLoader size={48} key={Math.floor(v * 3) + 20} /></div>
          </Tile>
        </div>

        <h2 className="mt-12 text-lg font-semibold tracking-tight">Which to use</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left"><th className="px-4 py-2.5 font-medium">Loader</th><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">Wait</th></tr></thead>
            <tbody>{LOADERS.map((l) => <tr key={l.name} className="border-b last:border-0"><td className="px-4 py-2.5 font-mono text-[0.8125rem]">{l.name}</td><td className="px-4 py-2.5 text-ink-2">{l.when}</td><td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">{l.wait}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
