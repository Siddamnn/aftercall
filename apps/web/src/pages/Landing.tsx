import { ArrowRight, ChatsCircle, Coins, Headset, Prohibit, Robot, StackSimple, Warning, type Icon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import sampleCalls from '../../../../samples/calls_booking.json'
import { AlteriaMark } from '../alteria-mark'
import { BuiltOn, Wordmark } from '../brand'
import { BILLING_ON, MOTTO } from '../config'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'
import { ease } from '../lib/motion'
import { Meter, Mono, ThemeButton, TypeTag } from '../ui'
import { title } from '../lib/format'
import type { SignalType } from '../api'

type Turn = { speaker: string; text: string }
type Answer = { tracker: string; name: string; type: SignalType; value: string; confidence: number; review?: boolean }
type Conversation = { id: string; source: string; icon: Icon; context: string; voice: boolean; lang?: string; turns: Turn[]; answers: Answer[] }

const CALL = (sampleCalls.calls as { external_id: string; transcript: Turn[] | string }[]).find((c) => c.external_id === 'sample-003')!

// Three kinds of conversation the demo cycles through. The answers are illustrative, not a live model call.
// `speaker: 'caller'` is the customer side and sits on the right.
const CONVERSATIONS: Conversation[] = [
  {
    id: CALL.external_id,
    source: 'AI voice agent',
    icon: Robot,
    context: 'clinic-booking v13',
    voice: true,
    lang: 'hi-Latn',
    turns: (CALL.transcript as Turn[]).slice(0, 4),
    answers: [
      { tracker: 'compliance', name: 'agent_misstated_policy', type: 'yes_no', value: 'Yes', confidence: 0.94 },
      { tracker: 'experience', name: 'asked_for_human', type: 'yes_no', value: 'Yes', confidence: 0.84 },
      { tracker: 'experience', name: 'frustration', type: 'score', value: '2 Frustrated', confidence: 0.66 },
      { tracker: 'outcome', name: 'call_outcome', type: 'choice', value: 'Other', confidence: 0.48, review: true },
    ],
  },
  {
    id: 'disc-0412',
    source: 'Sales call',
    icon: Headset,
    context: 'discovery · rep: Meera',
    voice: true,
    turns: [
      { speaker: 'agent', text: 'Before I show you pricing, roughly what budget did you set aside for this?' },
      { speaker: 'caller', text: "Around 40k a year, but honestly we're also looking at Northwind." },
      { speaker: 'agent', text: 'Fair. Want me to set up a demo with your ops lead on Thursday?' },
      { speaker: 'caller', text: 'Thursday works. Send the invite to Rahul as well.' },
    ],
    answers: [
      { tracker: 'discovery', name: 'asked_about_budget', type: 'yes_no', value: 'Yes', confidence: 0.97 },
      { tracker: 'discovery', name: 'competitor_mentioned', type: 'yes_no', value: 'Yes', confidence: 0.92 },
      { tracker: 'outcome', name: 'next_step', type: 'choice', value: 'Demo booked', confidence: 0.89 },
      { tracker: 'outcome', name: 'buying_intent', type: 'score', value: '2 Warm', confidence: 0.55, review: true },
    ],
  },
  {
    id: 'chat-8821',
    source: 'Support chat',
    icon: ChatsCircle,
    context: 'WhatsApp · order #4821',
    voice: false,
    turns: [
      { speaker: 'caller', text: 'My order came with the wrong size. Second time this month 😕' },
      { speaker: 'agent', text: "Sorry about that! I've raised a free exchange, pickup tomorrow." },
      { speaker: 'caller', text: "Fine, but I'd rather just get a refund this time." },
      { speaker: 'agent', text: "Understood, I've switched it to a refund to your card." },
    ],
    answers: [
      { tracker: 'resolution', name: 'issue_resolved', type: 'yes_no', value: 'Yes', confidence: 0.91 },
      { tracker: 'resolution', name: 'resolution_type', type: 'choice', value: 'Refund', confidence: 0.95 },
      { tracker: 'experience', name: 'repeat_complaint', type: 'yes_no', value: 'Yes', confidence: 0.88 },
      { tracker: 'experience', name: 'churn_risk', type: 'score', value: '2 Medium', confidence: 0.52, review: true },
    ],
  },
]

export default function Landing() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-20 border-b border-transparent bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="aftercall home"><Wordmark /></Link>
          <nav className="flex items-center gap-1 text-sm" aria-label="Site">
            <a href="#ask" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground md:block">What to ask</a>
            <a href="#how" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block">How it works</a>
            <a href="#alteria" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground md:block">Ask alteria</a>
            {BILLING_ON && <Link to="/pricing" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block">Pricing</Link>}
            <Link to="/docs" className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block">Docs</Link>
            <ThemeButton className="ml-1" />
            <Button asChild className="ml-2">
              <Link to="/trackers">Open the app</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="dot-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pt-24 lg:pb-24">
            <Hero />
            <Demo />
          </div>
        </section>

        <Sources />
        <Ask />
        <MeetAlteria />
        <How />
        {BILLING_ON && <Pricing />}

        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Your transcripts already know. Ask them.</h2>
              <p className="mt-1.5 text-ink-2">Start with five sample calls and three ready-made trackers. Answers in seconds.</p>
            </div>
            <Button asChild size="lg">
              <Link to="/analyse">Analyse the sample file <ArrowRight weight="bold" aria-hidden /></Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <Wordmark className="scale-90 origin-left opacity-80" />
          <span>Transcript analysis for calls and chats, at scale.</span>
          <BuiltOn />
          <nav aria-label="Footer" className="flex w-full flex-wrap gap-x-5 gap-y-1 border-t pt-4 sm:w-auto sm:border-0 sm:pt-0">
            {[...(BILLING_ON ? [['/pricing', 'Pricing']] : []), ['/docs', 'Docs'], ['/docs/support', 'Support'], ['/docs/privacy', 'Privacy'], ['/docs/terms', 'Terms'], ['/docs/security', 'Security']].map(([to, label]) => (
              <Link key={to} to={to} className="hover:text-foreground">{label}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}

const HEADLINE = ['Ask', 'every', 'conversation', 'the', 'same', 'question.']

function Hero() {
  return (
    <div>
      <motion.p
        className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-ink-2"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
      >
        <span className="size-1.5 rounded-full bg-primary" aria-hidden />
        Calls and chats, with people or AI agents
      </motion.p>
      <h1 className="text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-6xl">
        {HEADLINE.map((w, i) => (
          <motion.span
            key={i}
            className={cn('inline-block pr-[0.25em]', i === 1 && 'text-primary')}
            initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, ease, delay: 0.1 + i * 0.045 }}
          >
            {w}
          </motion.span>
        ))}
      </h1>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.5 }}>
        <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-ink-2">
          Drop in transcripts from sales calls, support lines, voice agents or chat. Say what you want to know, and aftercall answers it for every conversation, with a confidence score on each answer, at a fraction of what an LLM costs.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link to="/analyse">Analyse your transcripts <ArrowRight weight="bold" aria-hidden /></Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <a href="#how">See how it works</a>
          </Button>
        </div>
        <p className="mt-6 text-sm font-medium">{MOTTO}</p>
        {BILLING_ON && <p className="mt-1 text-sm text-muted-foreground">Priced per token. You see the cost before anything runs.</p>}
      </motion.div>
    </div>
  )
}

/**
 * A conversation plays in, then its answers resolve one by one, then the next kind of conversation
 * takes over. The source tabs jump straight to one. Static (fully resolved) when motion is reduced.
 */
function Demo() {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const conv = CONVERSATIONS[index]
  const total = conv.turns.length + conv.answers.length
  const [step, setStep] = useState(reduce ? total : 0)

  useEffect(() => {
    if (reduce) return
    const delay = step === 0 ? 700 : step < conv.turns.length ? 1200 : step < total ? 700 : 3800
    const t = setTimeout(() => {
      if (step < total) setStep(step + 1)
      else {
        setIndex((i) => (i + 1) % CONVERSATIONS.length)
        setStep(0)
      }
    }, delay)
    return () => clearTimeout(t)
  }, [step, total, conv.turns.length, reduce])

  const pick = (i: number) => {
    setIndex(i)
    setStep(reduce ? CONVERSATIONS[i].turns.length + CONVERSATIONS[i].answers.length : 0)
  }

  const shownTurns = Math.min(step, conv.turns.length)
  const resolved = Math.max(0, step - conv.turns.length)
  const analysing = step >= conv.turns.length && resolved < conv.answers.length
  const reviews = conv.answers.filter((a) => a.review).length
  const Source = conv.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease, delay: 0.25 }}
      className="relative"
    >
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-primary/[0.07] blur-2xl" aria-hidden />

      <div role="tablist" aria-label="Example conversations" className="mb-3 flex gap-1 rounded-xl border bg-card/80 p-1 backdrop-blur-sm">
        {CONVERSATIONS.map((c, i) => {
          const I = c.icon
          const active = i === index
          return (
            <button
              key={c.id}
              role="tab"
              aria-selected={active}
              onClick={() => pick(i)}
              className={cn('relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-150 active:scale-[0.97]', active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {active && <motion.span layoutId="demo-tab" className="absolute inset-0 rounded-lg bg-muted" transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }} />}
              <I size={14} weight={active ? 'fill' : 'regular'} className="relative" aria-hidden />
              <span className="relative truncate">{c.source}</span>
            </button>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-float" role="img" aria-label={`Example: a ${conv.source.toLowerCase()} and its answers`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={conv.id} className="flex min-w-0 items-center gap-2 text-sm" initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }}>
              <Source size={15} weight="fill" className="shrink-0 text-primary" aria-hidden />
              <Mono className="font-semibold">{conv.id}</Mono>
              <span className="truncate text-muted-foreground">{conv.context}</span>
            </motion.div>
          </AnimatePresence>
          {conv.voice ? <Wave active={step < conv.turns.length} /> : <span className="text-xs text-muted-foreground">{step < conv.turns.length ? 'typing…' : 'closed'}</span>}
        </div>

        <div className="grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Every transcript is stacked invisibly in the same cell, so the card keeps the tallest one's height for all of them. */}
          <div className="grid min-h-72 border-b sm:border-r sm:border-b-0 [&>*]:col-start-1 [&>*]:row-start-1">
            {CONVERSATIONS.map((c) => (
              <ol key={c.id} className="invisible flex flex-col gap-2.5 p-4" aria-hidden>
                {c.turns.map((t, i) => (
                  <li key={i} className="flex"><Bubble turn={t} lang={c.lang} /></li>
                ))}
              </ol>
            ))}
            <ol className="flex flex-col gap-2.5 p-4">
              <AnimatePresence initial={false} mode="popLayout">
                {conv.turns.slice(0, shownTurns).map((t, i) => {
                  const caller = t.speaker === 'caller'
                  return (
                    <motion.li
                      key={`${conv.id}-${i}`}
                      layout
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      transition={{ duration: 0.35, ease }}
                      className={cn('flex', caller ? 'justify-end' : 'justify-start')}
                    >
                      <Bubble turn={t} lang={conv.lang} />
                    </motion.li>
                  )
                })}
              </AnimatePresence>
              {step < conv.turns.length && <Typing caller={conv.turns[shownTurns]?.speaker === 'caller'} />}
            </ol>
          </div>

          <div className="p-4">
            <div className="mb-3 flex h-5 items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Answers</span>
              <AnimatePresence mode="wait" initial={false}>
                {analysing ? (
                  <motion.span key="a" className="shimmer-text font-medium" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Analysing…</motion.span>
                ) : resolved === conv.answers.length && reviews > 0 ? (
                  <motion.span key="d" className="font-medium text-warn" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{reviews} needs review</motion.span>
                ) : null}
              </AnimatePresence>
            </div>
            <ul className="space-y-2.5">
              {conv.answers.map((a, i) => {
                const done = i < resolved
                return (
                  <li key={`${conv.id}-${a.name}`} className={cn('rounded-lg border px-3 py-2 transition-colors duration-300', done && a.review ? 'border-warn/30 bg-warn-soft' : 'bg-background')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{title(a.tracker)}: {title(a.name)}</span>
                      <TypeTag type={a.type} className="h-4.5 shrink-0 px-1 text-[0.6875rem]" />
                    </div>
                    <div className="mt-1 flex h-6 items-center justify-between gap-3">
                      <AnimatePresence mode="wait" initial={false}>
                        {done ? (
                          <motion.span key="v" className="text-sm font-semibold" initial={{ opacity: 0, y: 4, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.25 }}>
                            {a.value}
                          </motion.span>
                        ) : (
                          <motion.span key="s" className="skeleton block h-3.5 w-16" exit={{ opacity: 0, transition: { duration: 0.1 } }} />
                        )}
                      </AnimatePresence>
                      {done && (
                        <motion.span className={cn('flex items-center gap-1.5 text-xs tabular-nums', a.review ? 'text-warn' : 'text-muted-foreground')} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          {a.review && <Warning size={11} weight="fill" aria-hidden />}
                          {Math.round(a.confidence * 100)}%
                        </motion.span>
                      )}
                    </div>
                    <Meter value={done ? a.confidence : 0} review={a.review} className="mt-1.5" />
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function Bubble({ turn, lang }: { turn: Turn; lang?: string }) {
  const caller = turn.speaker === 'caller'
  return (
    <p lang={lang} className={cn('max-w-[88%] rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-snug', caller ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted')}>
      {turn.text}
    </p>
  )
}

function Typing({ caller }: { caller: boolean }) {
  return (
    <li className={cn('flex', caller ? 'justify-end' : 'justify-start')} aria-hidden>
      <span className={cn('flex gap-1 rounded-2xl px-3 py-2.5', caller ? 'bg-primary/15' : 'bg-muted')}>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground/70"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
    </li>
  )
}

/** Live-call waveform; settles flat when the call ends. */
function Wave({ active }: { active: boolean }) {
  const bars = [0.5, 0.9, 0.6, 1, 0.7, 0.45, 0.8]
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden>
      {bars.map((b, i) => (
        <motion.span
          key={i}
          className={cn('w-[2px] rounded-full', active ? 'bg-primary' : 'bg-muted-foreground/40')}
          animate={active ? { height: [`${b * 40}%`, `${b * 100}%`, `${b * 30}%`] } : { height: '20%' }}
          transition={active ? { duration: 0.8 + i * 0.07, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' } : { duration: 0.3 }}
        />
      ))}
    </span>
  )
}

const SOURCES: [Icon, string, string][] = [
  [Headset, 'Sales and support calls', 'Transcripts from your dialer, call centre or meeting recorder.'],
  [Robot, 'AI voice agents', 'Every call your agent takes, not the handful someone listens to.'],
  [ChatsCircle, 'Chat and messaging', 'WhatsApp, web chat, email threads, bot conversations.'],
]

function Sources() {
  return (
    <section className="border-t">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:gap-12">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">Any conversation with a transcript.</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Upload CSV, JSON or JSONL. A transcript can be plain text or a list of turns, so exports from most call and chat tools work as they are.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {SOURCES.map(([I, t, b]) => (
              <li key={t} className="surface p-4">
                <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary"><I size={17} weight="fill" aria-hidden /></span>
                <h3 className="mt-3 text-sm font-semibold tracking-tight">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{b}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const USE_CASES: { team: string; asks: [string, SignalType][] }[] = [
  { team: 'Sales', asks: [['Did the rep ask about budget?', 'yes_no'], ['Which competitor came up?', 'choice'], ['How likely are they to buy?', 'score']] },
  { team: 'Support', asks: [['Was the issue resolved?', 'yes_no'], ['What was it about?', 'choice'], ['How annoyed was the customer?', 'score']] },
  { team: 'Collections', asks: [['Did they promise to pay?', 'yes_no'], ['Why haven\'t they paid?', 'choice'], ['Did the agent follow the script?', 'yes_no']] },
  { team: 'Voice agents', asks: [['Did the caller ask for a human?', 'yes_no'], ['How did the call end?', 'choice'], ['Did the agent misstate policy?', 'yes_no']] },
  { team: 'Chat and CX', asks: [['Is this a repeat complaint?', 'yes_no'], ['Refund, exchange or neither?', 'choice'], ['How likely are they to churn?', 'score']] },
  { team: 'Compliance', asks: [['Was the disclosure read out?', 'yes_no'], ['Was consent recorded?', 'yes_no'], ['How risky was the conversation?', 'score']] },
]

function Ask() {
  return (
    <section id="ask" className="scroll-mt-16 border-t bg-card/50">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="max-w-[22ch] text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">If you'd ask it on one call, ask it on all of them.</h2>
        <p className="mt-3 max-w-[56ch] text-ink-2">
          Write the questions you'd put to a reviewer, in plain words. Each one is a yes or no, a pick-one or a score, so every answer can be counted, filtered and trended.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((u) => (
            <li key={u.team} className="surface p-5">
              <h3 className="text-sm font-semibold tracking-tight">{u.team}</h3>
              <ul className="mt-3 space-y-1.5">
                {u.asks.map(([q, t]) => (
                  <li key={q} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5">
                    <span className="truncate text-sm">{q}</span>
                    <TypeTag type={t} className="h-4.5 shrink-0 px-1 text-[0.6875rem]" />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const STEPS = [
  {
    title: 'Say what you want to know',
    body: 'Group questions into trackers like Outcome, Compliance or Experience. Start from a template or write your own in plain words.',
    art: (
      <div className="space-y-1.5">
        {[['outcome', 'choice', 'call_outcome'], ['compliance', 'yes_no', 'agent_misstated_policy'], ['experience', 'score', 'frustration']].map(([c, t, q]) => (
          <div key={q} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <span className="truncate text-xs"><span className="text-muted-foreground">{title(c)}: </span>{title(q)}</span>
            <TypeTag type={t as SignalType} className="h-4.5 shrink-0 px-1 text-[0.6875rem]" />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Bring transcripts, see the cost first',
    body: 'Upload thousands of calls or chats at once. A dry run shows the tokens every conversation will use before anything is sent or charged.',
    art: (
      <div>
        <div className="flex h-7 gap-0.5 overflow-hidden rounded-md">
          {[1, 1, 1, 1, 1].map((_, i) => <div key={i} className="flex-1 bg-warn" />)}
          <div className="flex-[1.4] bg-primary" />
          <div className="hatch ml-1.5 w-5 rounded-md border border-stop/40 text-stop/40" />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><StackSimple size={11} weight="fill" className="text-warn" aria-hidden /> 1 long conversation</span>
          <span className="tabular-nums">~155k tokens</span>
        </div>
      </div>
    ),
  },
  {
    title: 'Get answers you can count on',
    body: 'Every answer has a confidence score. Anything below your review line goes to a person. Export it all as CSV.',
    art: (
      <div className="space-y-2">
        {[['booked', 0.97, false], ['other', 0.48, true]].map(([v, c, r]) => (
          <div key={v as string} className={cn('rounded-md border px-2.5 py-1.5', r ? 'border-warn/30 bg-warn-soft' : 'bg-background')}>
            <div className="flex justify-between text-xs"><span className="font-medium capitalize">{v as string}</span><span className={cn('tabular-nums', r ? 'text-warn' : 'text-muted-foreground')}>{Math.round((c as number) * 100)}%</span></div>
            <Meter value={c as number} review={r as boolean} className="mt-1" />
          </div>
        ))}
      </div>
    ),
  },
]

function How() {
  return (
    <section id="how" className="scroll-mt-16 border-t">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="max-w-[24ch] text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">From a pile of transcripts to answers you can trust.</h2>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="surface flex flex-col p-5">
              <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
              <h3 className="mt-4 font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{s.body}</p>
              <div className="mt-auto pt-6">{s.art}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-16 border-t bg-card/50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">In-depth answers.<br />Bulk prices.</h2>
          <p className="mt-4 max-w-[46ch] text-ink-2">
            aftercall runs a model built to answer precise questions, not a general chat model, so each conversation costs a fraction of what an LLM would. You pay for the tokens you use: the transcript plus the questions you chose. No seats, no per-field fees, no minimums.
          </p>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {[
            ['Ask as much as you like', 'There is no fee per question or per field. Each one only adds the few tokens it uses.', <Coins key="c" size={16} weight="fill" className="text-primary" aria-hidden />],
            ['See it before it runs', 'Every upload starts with a dry run: what will run, the tokens it will use, and the cost.', <ArrowRight key="a" size={16} weight="bold" className="text-primary" aria-hidden />],
            ['Long conversations are marked', "One too long to check in a single pass is split into parts. You see how many more tokens that uses before you run it.", <StackSimple key="s" size={16} weight="fill" className="text-warn" aria-hidden />],
            ['Over 30,000 tokens: not charged', 'Conversations over the limit are flagged and skipped, so they cost nothing.', <Prohibit key="p" size={16} weight="bold" className="text-stop" aria-hidden />],
          ].map(([t, b, icon]) => (
            <div key={t as string} className="bg-card p-5">
              <dt className="flex items-center gap-2 font-semibold tracking-tight">{icon}{t}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-ink-2">{b}</dd>
            </div>
          ))}
        </dl>
        <Link to="/pricing" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline lg:col-start-2">
          Credits and plans: pay as you go, or Pro <ArrowRight size={13} weight="bold" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

// ── alteria ────────────────────────────────────────────────────────────────────

const ALTERIA_POINTS: [string, string][] = [
  ['Chat with every conversation', 'Ask “why do customers decline?” and get the answer from all of them, with a chart and the calls behind it.'],
  ['A dashboard from one sentence', '“Build me a dashboard for agent quality.” Change it by chatting, then save it.'],
  ['No JSON, no setup', 'Paste transcripts in any format, or describe your goal. alteria prepares the file and drafts your trackers.'],
]

function MeetAlteria() {
  const bars: [string, number][] = [['Price', 36], ['Timing', 26], ['Not stated', 18], ['Went elsewhere', 14]]
  return (
    <section id="alteria" className="scroll-mt-16 border-t">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm font-semibold text-primary shadow-panel">
            <AlteriaMark size={16} active /> alteria
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Or just ask alteria.</h2>
          <p className="mt-4 max-w-[46ch] text-ink-2">aftercall answers from every conversation you’ve analysed, and alteria sets things up for you.</p>
          <ul className="mt-8 space-y-5">
            {ALTERIA_POINTS.map(([t, b]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><AlteriaMark size={15} /></span>
                <span>
                  <span className="block font-semibold tracking-tight">{t}</span>
                  <span className="block text-sm leading-relaxed text-ink-2">{b}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button asChild><Link to="/ask">Ask alteria <ArrowRight weight="bold" aria-hidden /></Link></Button>
            {BILLING_ON && <Button variant="outline" asChild><Link to="/pricing">See plans</Link></Button>}
          </div>
        </div>

        <motion.div initial="hide" whileInView="show" viewport={{ once: true, margin: '-80px' }} className="surface overflow-hidden" aria-label="An example chat with alteria">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-sm">
            <AlteriaMark size={16} className="text-primary" />
            <span className="font-semibold">Ask alteria</span>
            <span className="text-muted-foreground">· Clinic bookings · 30 days</span>
          </div>
          <div className="space-y-4 p-4">
            <motion.p variants={{ hide: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease } } }}
              className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-foreground">
              Why do customers decline?
            </motion.p>
            <motion.div className="flex gap-3" variants={{ hide: { opacity: 0 }, show: { opacity: 1, transition: { delay: 0.5, duration: 0.3 } } }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><AlteriaMark size={16} /></span>
              <div className="min-w-0 flex-1 space-y-3 text-sm">
                <p><b>327 of 1,300</b> conversations ended with a no. Price is the reason most give, and it comes up most on voice agent calls.</p>
                <ul className="space-y-1.5 rounded-xl border bg-card p-3">
                  {bars.map(([l, v], i) => (
                    <li key={l} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2">
                      <span className="truncate text-ink-2">{l}</span>
                      <span className="h-2">
                        <motion.span className="block h-full rounded-r-[4px] bg-primary" style={{ originX: 0, width: `${(v / 36) * 100}%` }}
                          variants={{ hide: { scaleX: 0 }, show: { scaleX: 1, transition: { delay: 0.8 + i * 0.08, duration: 0.5, ease } } }} />
                      </span>
                      <span className="text-right tabular-nums text-muted-foreground">{v}%</span>
                    </li>
                  ))}
                </ul>
                <p className="flex flex-wrap gap-1.5">
                  {['va-00412 · Declined · price', 'fd-01188 · Declined · price'].map((c) => (
                    <span key={c} className="rounded-lg border bg-card px-2 py-1 font-mono text-xs text-muted-foreground">{c}</span>
                  ))}
                </p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
