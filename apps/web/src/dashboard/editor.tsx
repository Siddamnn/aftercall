// Add or edit a dashboard chart. Two ways in: pick a suggestion (one click, previewed on hover),
// or build one: what to show → which chart → only the options that chart needs. Live preview.
import { Check, Plus, Sparkle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { Dimensions, Widget } from '../api'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { title } from '../lib/format'
import { ease } from '../lib/motion'
import { cn } from '../lib/utils'
import { Segmented, TypeTag } from '../ui'
import { useWidgetData, WidgetBody, type DashCtx } from './charts'
import {
  activeSignals, autoTitle, CONVERSATIONS, defaultValue, KIND_ORDER, KINDS, labelOf, makeWidget, newId, recommended, signalMeta,
  splitOptions, suggestions, unfit, widgetKey,
} from './model'

type Tab = 'suggested' | 'build'

export function WidgetEditor({ open, onOpenChange, initial, ctx, dims, existing, onSave }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Editing this chart; left out, adding new ones. */
  initial?: Widget
  ctx: DashCtx
  dims?: Dimensions
  existing: Widget[]
  onSave: (w: Widget) => void
}) {
  // Remount per opening so every open starts fresh.
  const [opens, setOpens] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpens((n) => n + 1)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <Editor key={opens} initial={initial} ctx={ctx} dims={dims} existing={existing} onSave={onSave} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Editor({ initial, ctx, dims, existing, onSave, onClose }: {
  initial?: Widget
  ctx: DashCtx
  dims?: Dimensions
  existing: Widget[]
  onSave: (w: Widget) => void
  onClose: () => void
}) {
  const signals = activeSignals(ctx.trackers)
  const sugg = suggestions(ctx.trackers, dims, existing)
  const [tab, setTab] = useState<Tab>(initial || !sugg.length ? 'build' : 'suggested')
  const [draft, setDraft] = useState<Widget>(() => initial ?? (signals[0] ? makeWidget(recommended(signals[0]), signals[0].ref, ctx.trackers) : makeWidget('kpi', CONVERSATIONS, ctx.trackers)))
  const [hover, setHover] = useState<Widget>()
  const [added, setAdded] = useState<Set<string>>(new Set())

  const meta = signalMeta(ctx.trackers, draft.metric)
  const splits = splitOptions(dims, signals, draft.metric)
  const needsBy = draft.kind === 'compare' || draft.kind === 'heatmap'
  const canSave = !needsBy || !!draft.by
  const preview = tab === 'suggested' ? hover ?? sugg[0]?.widget : draft

  const set = (patch: Partial<Widget>) => setDraft((d) => ({ ...d, ...patch }))
  const setMetric = (metric: string) => {
    const m = signalMeta(ctx.trackers, metric)
    const kind = unfit(draft.kind, m) ? recommended(m) : draft.kind
    setDraft((d) => ({
      ...d, metric, kind, value: ['kpi', 'line'].includes(kind) ? defaultValue(m) : undefined,
      by: d.by === metric ? undefined : d.by, size: kind === d.kind ? d.size : KINDS[kind].size,
    }))
  }
  const setKind = (kind: Widget['kind']) => {
    setDraft((d) => ({
      ...d, kind, size: KINDS[kind].size,
      value: ['kpi', 'line'].includes(kind) ? d.value ?? defaultValue(meta) : undefined,
      by: kind === 'compare' || kind === 'heatmap' ? d.by ?? splits.find((o) => o.value !== d.metric)?.value : undefined,
    }))
  }

  const addSuggestion = (w: Widget) => {
    onSave({ ...w, id: newId() })
    setAdded((s) => new Set(s).add(widgetKey(w)))
  }

  return (
    <div className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_1fr_auto]">
      <DialogHeader className="border-b px-6 pt-5 pb-4">
        <DialogTitle className="text-lg font-semibold tracking-tight">{initial ? 'Edit chart' : 'Add a chart'}</DialogTitle>
        <DialogDescription className="text-ink-2">
          {initial ? 'Change what it shows or how. The preview uses this dashboard’s filters.' : 'Start from a suggestion, or build your own from any signal.'}
        </DialogDescription>
        {!initial && sugg.length > 0 && (
          <Segmented id="editor-tab" label="How to add" className="mt-3 self-start" value={tab} onChange={setTab}
            options={[{ value: 'suggested', label: <span className="flex items-center gap-1.5"><Sparkle size={13} weight="fill" aria-hidden />Suggested</span> }, { value: 'build', label: 'Build your own' }]} />
        )}
      </DialogHeader>

      <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
          <AnimatePresence mode="wait" initial={false}>
            {tab === 'suggested' ? (
              <motion.ul key="s" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease }}
                className="space-y-1.5" onMouseLeave={() => setHover(undefined)}>
                {sugg.map(({ widget: w, why }) => {
                  const done = added.has(widgetKey(w))
                  const K = KINDS[w.kind]
                  return (
                    <li key={widgetKey(w)}>
                      <div
                        onMouseEnter={() => setHover(w)} onFocus={() => setHover(w)}
                        className={cn('group flex items-center gap-3 rounded-xl border p-2.5 transition-colors', hover === w ? 'border-primary/40 bg-primary-soft/60' : 'bg-card hover:bg-muted/60')}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-card text-primary"><K.Icon size={18} aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{autoTitle(w, ctx.trackers)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{K.label} · {why}</span>
                        </span>
                        <button
                          onClick={() => { setDraft({ ...w, id: newId() }); setTab('build') }}
                          className="hidden rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground group-hover:block group-focus-within:block"
                        >
                          Customise
                        </button>
                        <Button size="sm" variant={done ? 'secondary' : 'outline'} onClick={() => addSuggestion(w)} aria-label={done ? `Add ${autoTitle(w, ctx.trackers)} again` : `Add ${autoTitle(w, ctx.trackers)}`} className="w-20 shrink-0">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span key={String(done)} className="flex items-center gap-1" initial={{ opacity: 0, scale: 0.8, filter: 'blur(2px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }} transition={{ duration: 0.2, ease }}>
                              {done ? <><Check weight="bold" className="text-ok" aria-hidden /> Added</> : <><Plus aria-hidden /> Add</>}
                            </motion.span>
                          </AnimatePresence>
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </motion.ul>
            ) : (
              <motion.div key="b" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease }} className="space-y-6">
                <Step n={1} label="What do you want to see?">
                  <Select value={draft.metric} onValueChange={setMetric}>
                    <SelectTrigger className="w-full" aria-label="What to show"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CONVERSATIONS}>Conversations (how many)</SelectItem>
                      {ctx.trackers.filter((t) => t.active && t.signals.some((s) => s.active)).map((t) => (
                        <SelectGroup key={t.name}>
                          <SelectSeparator />
                          <SelectLabel>{title(t.name)}</SelectLabel>
                          {t.signals.filter((s) => s.active).map((s) => (
                            <SelectItem key={s.name} value={`${t.name}.${s.name}`}>{title(s.name)}</SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {meta && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><TypeTag type={meta.type} className="h-4.5 px-1 text-[0.6875rem]" /> in {title(meta.tracker)}</p>}
                </Step>

                <Step n={2} label="Show it as">
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" role="radiogroup" aria-label="Chart">
                    {KIND_ORDER.map((k) => {
                      const K = KINDS[k]
                      const why = unfit(k, meta)
                      const on = draft.kind === k
                      const best = recommended(meta) === k
                      const tile = (
                        <button
                          role="radio" aria-checked={on} disabled={!!why} onClick={() => setKind(k)}
                          className={cn(
                            'relative flex h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border text-xs font-medium transition-[color,background,border,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
                            on ? 'border-primary bg-primary-soft text-primary' : 'bg-card text-ink-2 hover:border-foreground/20 hover:text-foreground',
                          )}
                        >
                          <K.Icon size={20} weight={on ? 'fill' : 'regular'} aria-hidden />
                          {K.label}
                          {best && !why && <span className="absolute -top-1.5 right-1 rounded-full bg-primary px-1.5 text-[0.625rem] leading-4 text-primary-foreground">Best fit</span>}
                        </button>
                      )
                      return (
                        <Tooltip key={k}>
                          <TooltipTrigger asChild><span>{tile}</span></TooltipTrigger>
                          <TooltipContent>{why ?? K.hint}</TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                </Step>

                {(needsBy || (['kpi', 'line'].includes(draft.kind) && meta && meta.type !== 'score') || ['line', 'stacked'].includes(draft.kind)) && (
                  <Step n={3} label="Options">
                    <div className="space-y-4">
                      {needsBy && (
                        <Field label={draft.kind === 'heatmap' ? 'Cross it with' : 'Split by'}>
                          <Select value={draft.by ?? ''} onValueChange={(by) => set({ by })}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Pick one" /></SelectTrigger>
                            <SelectContent>
                              {(['Conversation', 'Signals'] as const).map((g) => splits.some((o) => o.group === g) && (
                                <SelectGroup key={g}>
                                  <SelectLabel>{g === 'Conversation' ? 'About the conversation' : 'Another signal’s answer'}</SelectLabel>
                                  {splits.filter((o) => o.group === g).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                      {['kpi', 'line'].includes(draft.kind) && meta && meta.type !== 'score' && (
                        <Field label="Follow the answer">
                          <Select value={draft.value ?? defaultValue(meta)} onValueChange={(value) => set({ value })}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>{meta.keys.map((k) => <SelectItem key={k} value={k}>{labelOf(meta, k)}</SelectItem>)}</SelectContent>
                          </Select>
                        </Field>
                      )}
                      {['line', 'stacked'].includes(draft.kind) && (
                        <Field label="Group by">
                          <Segmented id="editor-bucket" label="Group by" value={draft.bucket ?? 'auto'} onChange={(b) => set({ bucket: b === 'auto' ? undefined : b })}
                            options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
                        </Field>
                      )}
                    </div>
                  </Step>
                )}

                <Step n={needsBy || ['kpi', 'line', 'stacked'].includes(draft.kind) ? 4 : 3} label="Name and size">
                  <div className="space-y-4">
                    <Input value={draft.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} placeholder={autoTitle(draft, ctx.trackers)} aria-label="Chart name" maxLength={80} />
                    <Segmented id="editor-size" label="Width" value={String(draft.size) as '1' | '2' | '3'} onChange={(v) => set({ size: Number(v) as Widget['size'] })}
                      options={[{ value: '1', label: 'Narrow' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Full width' }]} />
                  </div>
                </Step>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="hidden min-h-0 flex-col border-l bg-muted/40 p-5 md:flex">
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Preview</p>
          {preview ? <Preview key={widgetKey(preview) + preview.bucket} w={preview} ctx={ctx} /> : <p className="text-sm text-muted-foreground">Hover a suggestion to preview it.</p>}
        </div>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        {tab === 'suggested' ? (
          <Button onClick={onClose}>{added.size ? `Done · ${added.size} added` : 'Done'}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => { onSave(draft); onClose() }}>{initial ? 'Save chart' : 'Add chart'}</Button>
          </>
        )}
      </DialogFooter>
    </div>
  )
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-5 place-items-center rounded-full bg-foreground text-[0.6875rem] text-background tabular-nums">{n}</span>
        {label}
      </h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function Preview({ w, ctx }: { w: Widget; ctx: DashCtx }) {
  const d = useWidgetData(w, ctx)
  return (
    <motion.article initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }} className="surface flex shrink-0 flex-col p-4">
      <h4 className="truncate font-semibold tracking-tight">{w.title || autoTitle(w, ctx.trackers)}</h4>
      <p className="mb-4 text-xs text-muted-foreground">{KINDS[w.kind].label} · {['Narrow', 'Medium', 'Full width'][w.size - 1]}</p>
      {(w.kind === 'compare' || w.kind === 'heatmap') && !w.by
        ? <p className="text-sm text-muted-foreground">Pick what to split it by.</p>
        : <div className="flex-1"><WidgetBody w={w} d={d} ctx={{ ...ctx, onDrill: () => {} }} /></div>}
    </motion.article>
  )
}
