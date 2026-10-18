// /ask: chat with every conversation in the project (B39, a Pro feature). A thread like a chat
// app: the answer streams in, then the chart that shows it, the conversations it came from,
// and follow-ups. Without Pro (once billing is on) there are three questions to try it. Chats are saved per project
// (B41): /ask starts a new one, /ask/:threadId resumes one, and the sidebar lists them.
import { ArrowRight, ArrowUp, Check, ChatsCircle, CopySimple, DotsThree, Eye, Headset, Lightning, LockSimple, NotePencil, PresentationChart, Quotes, ShareNetwork, SidebarSimple, Stop, UsersThree, Warning, X } from '@phosphor-icons/react'
import { AlteriaLoader, ChatReplyLoader } from '../loaders'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from '../lib/toast'
import {
  askAlteria, bulkThreads, copyThread, createDashboard, deleteThread, getDashboard, getInsights, getTeam, getThread, listDashboards, listThreads, listTrackers, saveDashboard, shareThread, updateThread, USING_MOCK,
  type AlteriaAnswer, type ApiError, type AskThread, type AskThreadSummary, type DashboardDraft, type InsightScope, type ThreadBulkAction, type Tracker, type Widget,
} from '../api'
import { chatMarkdown, markdownName, printChat, saveMarkdown, zip } from '../chat-export'
import { ConfirmAction } from '../confirm-action'
import { ConfirmDelete } from '../confirm-delete'
import { fileSlug, saveBlob } from '../lib/export'
import { Avatar, AvatarStack, ProDialog, useFeature } from '../people'
import { AlteriaMark } from '../alteria'
import { RenameInput, ThreadList, ThreadMenu, usePermissions, type ThreadActions } from '../ask-threads'
import { alteriaIncluded, reloadBilling, useBilling } from '../billing'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useWidgetData, WidgetBody, type DashCtx } from '../dashboard/charts'
import { autoTitle, KINDS, newId } from '../dashboard/model'
import { Input } from '../components/ui/input'
import { plural } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { ease } from '../lib/motion'
import { useProjectId } from '../project'
import { ProjectSwitcher, useProjects } from '../projects'
import { RANGES, rangeLabel, type Range } from '../scope'
import { Segmented } from '../ui'
import { CallPanel } from './Results'

const TRIAL = 3
const TRIAL_KEY = 'ask-trial-used'
const SIDEBAR_KEY = 'ask-sidebar-hidden'
const readKey = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const writeKey = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // Remembered for this visit only.
  }
}

const STARTERS: { q: string; Icon: typeof Headset }[] = [
  { q: 'Why are customers returning items?', Icon: Quotes },
  { q: 'What makes customers likely to leave?', Icon: Lightning },
  { q: 'How often do customers mention competitors?', Icon: UsersThree },
  { q: 'Build me a dashboard for return reasons', Icon: PresentationChart },
]

interface Msg {
  id: string
  role: 'user' | 'alteria'
  text: string
  answer?: AlteriaAnswer
  error?: string
  shown: number
  scope: InsightScope
  range: Range
  /** The dashboard this draft was saved as, or the saved one it changes. */
  savedId?: string
}

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const scopeFor = (r: Range): InsightScope => (r === 'all' ? {} : { from: day(Number(r) - 1), to: day(0) })
/** The range a stored scope was asked with, so a resumed chat keeps it. */
const rangeOf = (s: InsightScope): Range => {
  if (!s.from || !s.to) return 'all'
  const n = String(Math.round((Date.parse(s.to) - Date.parse(s.from)) / 86_400_000) + 1)
  return (RANGES.some((r) => r.value === n) ? n : '30') as Range
}

/** A saved chat as the page shows it: fully written out, with the open draft on its last board. */
function toMsgs(t: AskThread): Msg[] {
  const lastBoard = t.messages.findLastIndex((m) => m.answer?.dashboard)
  return t.messages.map((m, i) => {
    const answer = i === lastBoard && t.draft ? { ...m.answer!, dashboard: t.draft } : m.answer
    return {
      id: m.id, role: m.role, text: m.text, answer, error: m.error, scope: m.scope, range: rangeOf(m.scope),
      shown: answer?.text.length ?? 0,
      savedId: i === lastBoard ? t.saved_dashboard_id ?? undefined : undefined,
    }
  })
}

export default function Ask() {
  const { current } = useProjects()
  const project = useProjectId()
  const { threadId } = useParams()
  const navigate = useNavigate()
  const trackers = useLoad(listTrackers, [])
  const [range, setRange] = useState<Range>('30')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [params, setParams] = useSearchParams()
  // /ask?q=… (e.g. "Build with alteria" on Dashboards) starts with the question typed, not sent.
  const [text, setText] = useState(() => params.get('q') ?? '')
  useEffect(() => {
    if (params.has('q')) {
      setParams({}, { replace: true })
      requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [busy, setBusy] = useState(false)
  const [used, setUsed] = useState(() => Number(readKey(TRIAL_KEY)) || 0)
  const [open, setOpen] = useState<{ ids: string[]; at: number }>()
  const stopRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // alteria is open while billing is off; with billing on, it comes with Pro (B40).
  const billing = useBilling()
  const paid = alteriaIncluded(billing.data)
  // The backend counts free questions and refuses the 4th with a 402 (B49). Its count wins; the
  // one kept in this browser is only for display until it sends one.
  const [refused, setRefused] = useState(false)
  const left = billing.data?.limits?.alteria_trial_left ?? Math.max(0, TRIAL - used)
  const locked = refused || (!!billing.data && !paid && left === 0)
  const streaming = msgs.some((m) => m.role === 'alteria' && m.answer && m.shown < m.answer.text.length)

  // ── The saved chats ──
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 200)
    return () => clearTimeout(id)
  }, [query])
  const list = useLoad(() => listThreads(q), [q, project])
  const [threads, setThreads] = useState<AskThreadSummary[]>()
  useEffect(() => {
    if (list.data) setThreads(list.data.threads)
  }, [list.data])
  const [hidden, setHidden] = useState(() => readKey(SIDEBAR_KEY) === '1')
  const [sheet, setSheet] = useState(false)
  const toggleSidebar = () => setHidden((h) => (writeKey(SIDEBAR_KEY, h ? '0' : '1'), !h))
  const can = usePermissions()
  const shareable = useFeature('share_chats')
  const bulkExportable = useFeature('bulk_export')
  const [sharing, setSharing] = useState<AskThreadSummary>()
  const [pro, setPro] = useState<'share' | 'export'>()
  const [renaming, setRenaming] = useState(false)
  const [deletingHere, setDeletingHere] = useState(false)

  /** The chat whose messages are on screen: a thread id, or '' for a new chat not asked yet. */
  const shownRef = useRef('')
  /** A chat just created by asking: its messages are already on screen, so it isn't loaded. */
  const createdRef = useRef<string>(undefined)
  const [loadingThread, setLoadingThread] = useState(false)
  useEffect(() => {
    if (threadId && threadId === createdRef.current) {
      createdRef.current = undefined
      return
    }
    stopRef.current = true
    shownRef.current = threadId ?? ''
    setOpen(undefined)
    if (!threadId) {
      setMsgs([])
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    let live = true
    setLoadingThread(true)
    getThread(threadId).then(
      (t) => {
        if (!live) return
        const m = toMsgs(t)
        setMsgs(m)
        if (m.length) setRange(m[m.length - 1].range)
        requestAnimationFrame(() => scrollTo({ top: document.body.scrollHeight }))
        // Export → PDF from another chat's menu opens it here, then prints once its charts are drawn.
        if (new URLSearchParams(location.search).has('print')) {
          navigate(`/ask/${threadId}`, { replace: true })
          setTimeout(() => printChat(t.title), 900)
        }
      },
      (e: ApiError) => {
        if (!live) return
        toast.error(e.status === 404 ? 'That chat isn’t in this project.' : e.message)
        shownRef.current = ''
        setMsgs([])
        navigate('/ask', { replace: true })
      },
    ).finally(() => live && setLoadingThread(false))
    return () => void (live = false)
  }, [threadId, navigate])

  const newChat = () => {
    setSheet(false)
    if (threadId) navigate('/ask')
    else requestAnimationFrame(() => inputRef.current?.focus())
  }

  // ⇧⌘O starts a new chat, like other chat apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'o' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        newChat()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const patch = (id: string, change: Partial<AskThreadSummary>) => setThreads((ts) => ts?.map((t) => (t.id === id ? { ...t, ...change } : t)))
  const actions: ThreadActions = {
    onRename: (id, title) => {
      patch(id, { title })
      updateThread(id, { title }).catch((e: Error) => (toast.error(e.message), list.reload()))
    },
    onPin: (id, pinned) => {
      // Pinned chats sit at the top; the rest stay newest first.
      setThreads((ts) => ts && [...ts.map((t) => (t.id === id ? { ...t, pinned } : t))].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)))
      updateThread(id, { pinned }).catch((e: Error) => (toast.error(e.message), list.reload()))
    },
    onDelete: async (id) => {
      await deleteThread(id)
      setThreads((ts) => ts?.filter((t) => t.id !== id))
      if (id === threadId) navigate('/ask', { replace: true })
      toast.success('Chat deleted')
    },
    onShare: (t) => (shareable ? setSharing(t) : setPro('share')),
    onExport: async (t, as) => {
      setSheet(false)
      if (as === 'pdf') {
        if (t.id === threadId && !loadingThread) printChat(t.title)
        else navigate(`/ask/${t.id}?print=1`)
        return
      }
      try {
        const full = await getThread(t.id)
        saveMarkdown(chatMarkdown(full, current?.name ?? project ?? 'aftercall', trackers.data ?? []), markdownName(full))
      } catch (e) {
        toast.error((e as ApiError).message)
      }
    },
    onCopy: async (t) => {
      try {
        const copy = await copyThread(t.id)
        setThreads((ts) => [copy, ...(ts ?? [])])
        setSheet(false)
        navigate(`/ask/${copy.id}`)
        toast.success('Your copy is ready', { description: 'It’s private to you. Ask anything to carry on from here.' })
      } catch (e) {
        toast.error((e as ApiError).message)
      }
    },
    onBulk: async (ids, action) => {
      try {
        const r = await bulkThreads(ids, action)
        const done = new Set(r.done)
        const at = new Date().toISOString()
        setThreads((ts) => {
          if (!ts) return ts
          if (action === 'delete') return ts.filter((t) => !done.has(t.id))
          const next = ts.map((t) => (!done.has(t.id) ? t : action === 'share' ? { ...t, shared_at: t.shared_at ?? at } : { ...t, pinned: action === 'pin' }))
          return next.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
        })
        if (action === 'delete' && threadId && done.has(threadId)) navigate('/ask', { replace: true })
        bulkToast(action, r.done.length, r.failed)
        return r.done
      } catch (e) {
        const err = e as ApiError
        if (err.status === 402) setPro('share')
        else toast.error(err.message)
        return []
      }
    },
    onBulkExport: async (ids) => {
      if (!bulkExportable) return setPro('export')
      try {
        const all = await Promise.all(ids.map((id) => getThread(id)))
        const name = current?.name ?? project ?? 'aftercall'
        saveBlob(zip(all.map((t) => ({ name: markdownName(t), text: chatMarkdown(t, name, trackers.data ?? []) }))), `${fileSlug(name)}-chats.zip`)
        toast.success(`Exported ${all.length === 1 ? '1 chat' : `${all.length} chats`}`)
      } catch (e) {
        toast.error((e as ApiError).message)
      }
    },
  }
  const thread = threadId ? threads?.find((t) => t.id === threadId) : undefined
  const title = thread?.title
  const readOnly = !!thread && thread.mine === false

  // The dashboard draft is kept with the chat, so it can be picked up another day.
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keepDraft = (d: DashboardDraft, savedId?: string) => {
    const id = threadId
    if (!id) return
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      updateThread(id, { draft: d, ...(savedId ? { saved_dashboard_id: savedId } : {}) }).catch(() => {
        // The draft on screen is still right; it's saved with the next question.
      })
    }, savedId ? 0 : 600)
  }

  // Keep the newest message in view while it streams, unless the user scrolled up to read.
  useEffect(() => {
    const nearBottom = innerHeight + scrollY >= document.body.scrollHeight - 240
    if (nearBottom) scrollTo({ top: document.body.scrollHeight, behavior: streaming ? 'auto' : 'smooth' })
  }, [msgs, streaming])

  const ask = async (question: string) => {
    question = question.trim()
    if (!question || busy || locked) return
    setText('')
    setBusy(true)
    stopRef.current = false
    const scope = scopeFor(range)
    const asked = shownRef.current
    const isShown = () => shownRef.current === asked
    // The latest dashboard draft stays open, so "add …" or "remove …" changes it.
    const draftMsg = [...msgs].reverse().find((m) => m.answer?.dashboard)
    const aid = newId()
    setMsgs((m) => [...m, { id: newId(), role: 'user', text: question, shown: 0, scope, range }, { id: aid, role: 'alteria', text: '', shown: 0, scope, range, savedId: draftMsg?.savedId }])
    try {
      const answer = await askAlteria(question, scope, asked || undefined, draftMsg?.answer?.dashboard)
      if (!paid) {
        const n = used + 1
        setUsed(n)
        writeKey(TRIAL_KEY, String(n))
        void reloadBilling()
      }
      // A new chat: it's saved now, so give it its address and put it at the top of the list.
      if (answer.thread_id && answer.thread_id !== asked) {
        const at = new Date().toISOString()
        const tid = answer.thread_id
        setThreads((ts) => [{ id: tid, title: answer.title ?? question, pinned: false, created_at: at, updated_at: at, message_count: 2, preview: question }, ...(ts ?? []).filter((t) => t.id !== tid)])
        if (isShown()) {
          shownRef.current = tid
          createdRef.current = tid
          navigate(`/ask/${tid}`, { replace: !asked })
        }
      } else if (asked) {
        const at = new Date().toISOString()
        setThreads((ts) => ts && [...ts.map((t) => (t.id === asked ? { ...t, updated_at: at, preview: question, message_count: t.message_count + 2 } : t))].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)))
      }
      if (!isShown() && shownRef.current !== answer.thread_id) return // the user moved to another chat
      setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, answer } : x)))
      // Stream it: a few characters a frame, like it's being written.
      await new Promise<void>((done) => {
        let shown = 0
        const tick = () => {
          shown = stopRef.current ? answer.text.length : Math.min(answer.text.length, shown + 3 + Math.floor(Math.random() * 4))
          setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, shown } : x)))
          if (shown < answer.text.length) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
    } catch (e) {
      const err = e as ApiError
      if (err.status === 402) setRefused(true)
      const msg = USING_MOCK || (err.status !== 404 && err.status !== 405) ? err.message : 'Ask alteria needs the backend’s /alteria/ask endpoint (request B39).'
      if (isShown()) setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, error: msg } : x)))
    } finally {
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const citations = (ids: string[], at: number) => setOpen({ ids, at })
  const listProps = {
    threads, loading: list.loading, error: list.error, activeId: threadId, query, onQuery: setQuery, onNew: newChat, actions,
  }

  return (
    <div className="md:flex">
      {/* The chat list: beside the chat on wide screens (hideable), in a sheet on phones. */}
      <AnimatePresence initial={false}>
        {!hidden && (
          <motion.aside
            key="threads"
            aria-label="Your chats"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 272, opacity: 1 }}
            exit={{ width: 0, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease }}
            className="sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-r bg-muted/25 md:block print:!hidden"
          >
            <div className="flex h-full w-[272px] flex-col px-3 pt-5">
              <ProjectSwitcher className="mb-3" />
              <ThreadList {...listProps} className="flex-1" />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-[85%] max-w-80 px-3 pt-4 md:hidden">
          <SheetTitle className="px-1 text-base font-semibold">Chats</SheetTitle>
          <ThreadList {...listProps} onPick={() => setSheet(false)} className="min-h-0 flex-1" />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1 px-4 pt-6 md:px-10 md:pt-8">
        <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-3xl flex-col md:min-h-[calc(100dvh-2rem)]">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="hidden text-muted-foreground md:inline-flex print:!hidden" onClick={toggleSidebar} aria-label={hidden ? 'Show chats' : 'Hide chats'} aria-expanded={!hidden}>
                    <SidebarSimple size={18} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{hidden ? 'Show chats' : 'Hide chats'}</TooltipContent>
              </Tooltip>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground md:hidden" onClick={() => setSheet(true)} aria-label="Chats">
                <ChatsCircle size={18} aria-hidden />
              </Button>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><AlteriaMark size={20} active={busy} /></span>
              <div className="min-w-0 leading-tight">
                {renaming && thread ? (
                  <RenameInput title={thread.title} className="h-7 w-64 text-base font-semibold" onDone={(t) => (setRenaming(false), t && t !== thread.title && actions.onRename(thread.id, t))} />
                ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.h1
                    key={title ?? 'Ask alteria'}
                    className="truncate text-lg font-semibold tracking-tight"
                    initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.25, ease }}
                  >
                    {title ?? 'Ask alteria'}
                  </motion.h1>
                </AnimatePresence>
                )}
                <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                  {thread?.shared_at && thread.owner ? (
                    <><Avatar p={thread.owner} size={14} /> Shared by {thread.mine ? 'you' : thread.owner.name} · {new Date(thread.shared_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</>
                  ) : thread?.copied_from ? (
                    <><CopySimple size={12} aria-hidden /> Your copy of {thread.copied_from.by.name.split(' ')[0]}’s chat</>
                  ) : (
                    <>{thread && <LockSimple size={11} aria-label="Private" />}{current ? current.name : ' '} · {rangeLabel(range).toLowerCase()}</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              {!readOnly && <Segmented id="ask-range" label="Time range" options={RANGES} value={range} onChange={setRange} />}
              {thread && can.canShare(thread) && (
                <Button variant="outline" size="sm" onClick={() => actions.onShare(thread)}>
                  <ShareNetwork aria-hidden /> Share {!shareable && <span className="size-1.5 rounded-full bg-primary" aria-label="Pro" />}
                </Button>
              )}
              {thread?.shared_at && <SharedChip />}
              {thread && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Chat options"><DotsThree size={18} weight="bold" aria-hidden /></Button>
                  </DropdownMenuTrigger>
                  <ThreadMenu t={thread} align="end" onRename={() => setRenaming(true)} onAskDelete={() => setDeletingHere(true)} actions={actions} shareable={shareable} />
                </DropdownMenu>
              )}
              {(hidden || threadId) && (
                <Button variant="ghost" size="sm" className={hidden ? '' : 'md:hidden'} onClick={newChat}><NotePencil aria-hidden /> New chat</Button>
              )}
            </div>
          </header>

          <div className="flex-1">
            {loadingThread ? (
              <ol className="space-y-6 pb-6" aria-label="Loading the chat">
                <li className="flex justify-end"><span className="skeleton h-10 w-2/5 rounded-2xl" /></li>
                <li className="flex gap-3"><span className="skeleton size-8 rounded-lg" /><span className="flex-1 space-y-2"><span className="skeleton block h-4 w-11/12 rounded" /><span className="skeleton block h-4 w-3/4 rounded" /><span className="skeleton block h-40 rounded-xl" /></span></li>
              </ol>
            ) : msgs.length === 0 ? (
              <Welcome project={current?.name} onAsk={ask} disabled={locked} />
            ) : (
              <ol className="space-y-6 pb-6" aria-live="polite">
                {msgs.map((m, i) => (
                  <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}>
                    {m.role === 'user' ? (
                      <div className="flex justify-end">
                        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">{m.text}</p>
                      </div>
                    ) : (
                      <Answer
                        m={m} last={i === msgs.length - 1} trackers={trackers.data ?? []} onAsk={ask} onOpen={citations} busy={busy}
                        latestDraft={[...msgs].reverse().find((x) => x.answer?.dashboard)?.id === m.id}
                        onDraft={(d, savedId) => {
                          setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, savedId: savedId ?? x.savedId, answer: { ...x.answer!, dashboard: d } } : x)))
                          keepDraft(d, savedId)
                        }}
                      />
                    )}
                  </motion.li>
                ))}
              </ol>
            )}
          </div>

          <div className="sticky bottom-0 -mx-2 bg-gradient-to-t from-background from-70% to-transparent px-2 pt-6 pb-4 md:pb-6 print:hidden">
            {readOnly && thread ? (
              <ReadOnly t={thread} onCopy={() => actions.onCopy(thread)} />
            ) : can.cannotAsk ? (
              <p className="rounded-2xl border bg-card p-4 text-sm text-ink-2 shadow-float"><Eye size={15} className="mr-1.5 inline text-muted-foreground" aria-hidden />You can read chats the team shares, but not ask. An admin can change your role, or make you a member so you can ask alteria.</p>
            ) : locked ? (
              <Upgrade />
            ) : (
              <>
                <form
                  onSubmit={(e) => (e.preventDefault(), ask(text))}
                  className="flex items-end gap-2 rounded-2xl border bg-card p-2 pl-4 shadow-float transition-[border-color] focus-within:border-primary/50"
                >
                  <textarea
                    ref={inputRef} rows={1} value={text} placeholder={`Ask about the conversations in ${current?.name ?? 'this project'}…`}
                    aria-label="Your question" disabled={busy}
                    onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px` }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) } }}
                    className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[0.9375rem] outline-none placeholder:text-muted-foreground disabled:opacity-60"
                  />
                  {streaming ? (
                    <Button type="button" size="icon" variant="outline" className="size-9 rounded-xl" onClick={() => (stopRef.current = true)} aria-label="Stop"><Stop weight="fill" aria-hidden /></Button>
                  ) : (
                    <Button type="submit" size="icon" className="size-9 rounded-xl" disabled={!text.trim() || busy} aria-label="Ask"><ArrowUp weight="bold" aria-hidden /></Button>
                  )}
                </form>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {billing.data && !paid
                    ? <>{left} of {TRIAL} free questions left. Ask alteria is part of <Link to="/pricing" className="font-medium text-primary hover:underline">Pro</Link>.</>
                    : 'alteria answers from the signals your trackers collect, and shows the conversations behind every answer.'}
                </p>
              </>
            )}
          </div>

          <ShareDialog t={sharing} onClose={() => setSharing(undefined)} project={current?.name} onShared={(s) => setThreads((ts) => ts?.map((t) => (t.id === s.id ? { ...t, ...s } : t)))} />
          <ProDialog open={!!pro} onOpenChange={(o) => !o && setPro(undefined)} title={pro === 'export' ? 'Exporting many chats is part of Pro' : 'Sharing chats is part of Pro'}>
            {pro === 'export'
              ? 'On pay as you go you can export any chat on its own, as Markdown or PDF. Pro exports a whole selection as one .zip, and lets you share chats with your team.'
              : 'With Pro, share a chat with everyone in the project: they read it, see its charts and the conversations behind it, and carry on in their own copy.'}
          </ProDialog>
          {thread && (
            <ConfirmDelete open={deletingHere} onOpenChange={setDeletingHere} title={thread.shared_at ? 'Delete this chat for everyone?' : 'Delete this chat?'} onConfirm={() => actions.onDelete(thread.id)}>
              {thread.shared_at ? <>“{thread.title}” is shared with the team. Deleting it removes it for everyone. Copies teammates made stay.</> : <>“{thread.title}” and its answers will be deleted. Dashboards you saved from it stay.</>}
            </ConfirmDelete>
          )}

          <CallPanel
            id={open ? String(open.ids[open.at]) : undefined}
            open={!!open}
            trackers={trackers.data ?? []}
            onClose={() => setOpen(undefined)}
            onDeleted={() => setOpen(undefined)}
            position={open ? { at: open.at, of: open.ids.length } : undefined}
            onStep={(d) => setOpen((o) => o && { ...o, at: Math.max(0, Math.min(o.ids.length - 1, o.at + d)) })}
          />
        </div>
      </div>
    </div>
  )
}

function Welcome({ project, onAsk, disabled }: { project?: string; onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center pt-8 text-center sm:pt-16">
      <motion.span initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease }} className="grid size-16 place-items-center rounded-2xl bg-primary-soft text-primary">
        <AlteriaMark size={36} active />
      </motion.span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">What do you want to know?</h2>
      <p className="mt-2 max-w-[48ch] text-ink-2">
        Ask anything about the conversations in {project ? <b className="font-semibold text-foreground">{project}</b> : 'this project'}. alteria answers from every one of them, with a chart and the conversations behind it.
      </p>
      <ul className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {STARTERS.map(({ q, Icon }, i) => (
          <motion.li key={q} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.1 + i * 0.05 }}>
            <button disabled={disabled} onClick={() => onAsk(q)} className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-left transition-[border-color,transform] duration-150 hover:border-primary/40 active:scale-[0.98] disabled:opacity-50">
              <Icon size={18} className="shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
              <span className="text-sm font-medium">{q}</span>
              <ArrowRight size={14} className="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </button>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

/** **bold** and "- " bullets are all the formatting answers use. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : part))
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        const bullets = lines.filter((l) => l.startsWith('- '))
        const lead = lines.filter((l) => !l.startsWith('- '))
        return (
          <div key={i} className="space-y-1.5">
            {lead.map((l, j) => <p key={j}>{inline(l)}</p>)}
            {bullets.length > 0 && <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{bullets.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>}
          </div>
        )
      })}
    </div>
  )
}

function Answer({ m, last, trackers, onAsk, onOpen, busy, latestDraft, onDraft }: {
  m: Msg
  last: boolean
  trackers: Tracker[]
  onAsk: (q: string) => void
  onOpen: (ids: string[], at: number) => void
  busy: boolean
  latestDraft: boolean
  onDraft: (d: DashboardDraft, savedId?: string) => void
}) {
  const navigate = useNavigate()
  const a = m.answer
  const done = !!a && m.shown >= a.text.length
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">{!a && !m.error ? <AlteriaLoader size={18} label="alteria is thinking" /> : <AlteriaMark size={18} active={!done && !m.error} />}</span>
      <div className="min-w-0 flex-1 space-y-4">
        {m.error ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-stop/25 bg-stop-soft px-3 py-2 text-sm"><Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-stop" aria-hidden />{m.error}</p>
        ) : !a ? (
          <ChatReplyLoader className="pt-1.5" />
        ) : (
          <>
            <Rich text={a.text.slice(0, m.shown)} />
            <AnimatePresence>
              {done && (
                <motion.div className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
                  {a.chart && <ChatChart chart={a.chart} scope={m.scope} trackers={trackers} />}
                  {a.dashboard && (latestDraft
                    ? <DraftBoard draft={a.dashboard} m={m} trackers={trackers} onChange={onDraft} />
                    : <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Earlier draft: {a.dashboard.name}, {plural(a.dashboard.widgets.length, 'chart')}. The newest version is below.</p>)}
                  {a.citations.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">From these conversations</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {a.citations.map((c, i) => (
                          <li key={c.call_id}>
                            <button onClick={() => onOpen(a.citations.map((x) => x.call_id), i)} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs transition-[border-color,transform] duration-150 hover:border-primary/40 active:scale-[0.97]">
                              <span className="font-mono font-medium">{c.external_id ?? `Call ${c.call_id}`}</span>
                              <span className="truncate text-muted-foreground">{c.why}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {a.suggest_signal && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary-soft/50 p-3">
                      <p className="min-w-0 flex-1 text-sm"><b className="font-semibold">Track it from now on.</b> alteria drafts the signal from your question; you check it first.</p>
                      <Button size="sm" onClick={() => navigate(`/trackers/${trackers.find((t) => t.active)?.name ?? '_new'}/_new?ask=${encodeURIComponent(a.suggest_signal!)}`)}>
                        <AlteriaMark /> Draft the signal
                      </Button>
                    </div>
                  )}
                  {last && a.follow_ups.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 print:hidden">
                      {a.follow_ups.map((f) => (
                        <li key={f}>
                          <button disabled={busy} onClick={() => onAsk(f)} className="rounded-full border bg-card px-3 py-1 text-sm text-ink-2 transition-[border-color,color,transform] duration-150 hover:border-primary/40 hover:text-foreground active:scale-[0.97] disabled:opacity-50">{f}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}

/** The chart alteria picked, drawn with the dashboard's own chart, and one click to keep it. */
function ChatChart({ chart, scope, trackers }: { chart: NonNullable<AlteriaAnswer['chart']>; scope: InsightScope; trackers: Tracker[] }) {
  const s: InsightScope = chart.where?.length ? { ...scope, where: [...(scope.where ?? []), ...chart.where] } : scope
  const key = JSON.stringify(s)
  const insights = useLoad(() => getInsights(s), [key])
  const dashboards = useLoad(listDashboards, [])
  const range: Range = !s.from ? 'all' : (String((Date.parse(s.to!) - Date.parse(s.from)) / 86_400_000 + 1) as Range)
  const ctx: DashCtx = { scope: s, insights: insights.data, trackers, range, onDrill: () => {} }
  const d = useWidgetData(chart.widget, ctx)
  const name = chart.widget.title ?? autoTitle(chart.widget, trackers)
  const keep = async (id: string, dname: string) => {
    try {
      const cur = await getDashboard(id)
      await saveDashboard(id, { ...cur, widgets: [...cur.widgets, { ...chart.widget, id: newId() }] })
      toast.success(`Added to ${dname}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <figure className="surface p-4">
      <figcaption className="mb-3 flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{name}</span>
          {chart.where?.length ? <span className="text-xs text-muted-foreground">Only the conversations this answer is about</span> : null}
        </span>
        {!!dashboards.data?.length && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground print:hidden">Add to a dashboard</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Add this chart to</DropdownMenuLabel>
              {dashboards.data.map((db) => <DropdownMenuItem key={db.id} onSelect={() => keep(db.id, db.name)}>{db.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </figcaption>
      <WidgetBody w={chart.widget} d={d} ctx={ctx} />
    </figure>
  )
}

/** A dashboard alteria drafted: rename it, remove charts, keep chatting to change it, then save. */
function DraftBoard({ draft, m, trackers, onChange }: { draft: DashboardDraft; m: Msg; trackers: Tracker[]; onChange: (d: DashboardDraft, savedId?: string) => void }) {
  const navigate = useNavigate()
  const insights = useLoad(() => getInsights(m.scope), [JSON.stringify(m.scope)])
  const [saving, setSaving] = useState(false)
  const [savedAs, setSavedAs] = useState<string>()
  const [dirty, setDirty] = useState(true) // a new draft always differs from anything saved
  const ctx: DashCtx = { scope: m.scope, insights: insights.data, trackers, range: m.range, onDrill: () => {} }
  const change = (d: DashboardDraft) => { onChange(d); setDirty(true) }
  const save = async () => {
    setSaving(true)
    try {
      const body = { name: draft.name.trim() || 'Untitled dashboard', description: draft.description, params: `range=${m.range}`, widgets: draft.widgets.map((w) => ({ ...w, id: newId() })) }
      const d = m.savedId ? await saveDashboard(m.savedId, body) : await createDashboard(body)
      onChange(draft, d.id)
      setSavedAs(d.id)
      setDirty(false)
      toast.success(m.savedId ? `Updated ${d.name}` : `Saved ${d.name}`, { action: { label: 'Open', onClick: () => navigate(`/dashboards/${d.id}`) } })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const id = savedAs ?? m.savedId
  return (
    <section className="rounded-2xl border bg-muted/30 p-3 sm:p-4" aria-label="Dashboard draft">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <PresentationChart size={18} className="text-primary" aria-hidden />
        <Input value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} aria-label="Dashboard name" maxLength={80}
          className="h-8 max-w-64 flex-1 border-transparent bg-transparent px-1.5 font-semibold shadow-none hover:border-border focus-visible:bg-card" />
        <span className="text-xs text-muted-foreground">{plural(draft.widgets.length, 'chart')} · {rangeLabel(m.range).toLowerCase()}</span>
        <span className="ml-auto flex items-center gap-2">
          {id && !dirty ? (
            <>
              <span className="flex items-center gap-1 text-sm text-ok"><Check weight="bold" aria-hidden /> Saved</span>
              <Button size="sm" variant="outline" asChild><Link to={`/dashboards/${id}`}>Open</Link></Button>
            </>
          ) : (
            <Button size="sm" onClick={save} disabled={saving || !draft.widgets.length}>{saving ? 'Saving…' : m.savedId ? 'Update dashboard' : 'Save dashboard'}</Button>
          )}
        </span>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {draft.widgets.map((w) => (
            <motion.li key={w.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease }}
              className={w.size > 1 ? 'sm:col-span-2' : ''}>
              <MiniChart w={w} ctx={ctx} onRemove={() => change({ ...draft, widgets: draft.widgets.filter((x) => x.id !== w.id) })} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  )
}

function MiniChart({ w, ctx, onRemove }: { w: Widget; ctx: DashCtx; onRemove: () => void }) {
  const d = useWidgetData(w, ctx)
  const K = KINDS[w.kind]
  return (
    <article className="surface group/mini h-full p-3">
      <header className="mb-2 flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{w.title ?? autoTitle(w, ctx.trackers)}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><K.Icon size={11} aria-hidden /> {K.label}</span>
        </span>
        <button onClick={onRemove} className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground group-hover/mini:opacity-100" aria-label={`Remove ${w.title ?? autoTitle(w, ctx.trackers)}`}>
          <X size={12} weight="bold" aria-hidden />
        </button>
      </header>
      <WidgetBody w={w} d={d} ctx={ctx} />
    </article>
  )
}

function Upgrade(): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/25 bg-card p-4 shadow-float">
      <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><AlteriaMark size={22} /></span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-semibold">You've used your 3 free questions</p>
        <p className="text-sm text-ink-2">Ask alteria is part of Pro: unlimited questions across every conversation in every project.</p>
      </div>
      <Button asChild><Link to="/pricing">See Pro</Link></Button>
    </div>
  )
}

const BULK_DONE: Record<ThreadBulkAction, string> = { delete: 'deleted', pin: 'pinned', unpin: 'unpinned', share: 'shared with the team' }

/** "18 deleted", or "18 deleted, 2 couldn’t be" with the reasons. */
function bulkToast(action: ThreadBulkAction, done: number, failed: { detail: string }[]) {
  const head = `${done === 1 ? '1 chat' : `${done} chats`} ${BULK_DONE[action]}`
  if (!failed.length) return toast.success(head)
  const why = [...new Set(failed.map((f) => f.detail))].join(' ')
  toast.warning(done ? `${head}, ${failed.length} couldn’t be` : `${failed.length === 1 ? 'That chat' : 'Those chats'} couldn’t be ${BULK_DONE[action]}`, { description: why })
}

function SharedChip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 text-xs font-medium text-primary"><UsersThree size={14} aria-hidden /> Shared</span>
      </TooltipTrigger>
      <TooltipContent>Everyone in this project can read it</TooltipContent>
    </Tooltip>
  )
}

/** Share once, with the whole project team. It says who will see it, and that it can't be undone. */
function ShareDialog({ t, onClose, project, onShared }: { t?: AskThreadSummary; onClose: () => void; project?: string; onShared: (t: AskThreadSummary) => void }) {
  const team = useLoad(() => (t ? getTeam() : Promise.resolve(undefined)), [t?.id])
  const others = team.data?.members.filter((m) => m.id !== t?.owner?.id) ?? []
  const names = others.map((m) => m.name.split(' ')[0])
  const who = names.length === 0 ? 'Everyone who joins this workspace' : names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`
  return (
    <ConfirmAction
      open={!!t}
      onOpenChange={(o) => !o && onClose()}
      title="Share with the team?"
      action="Share with the team"
      onConfirm={async () => {
        const s = await shareThread(t!.id)
        onShared(s)
        toast.success('Shared with the team', { description: 'Teammates can read it and carry on in their own copy.' })
      }}
    >
      <span className="block">
        <b className="font-semibold text-foreground">“{t?.title}”</b> will show in everyone’s chats in {project ?? 'this project'}, with your avatar on it.
      </span>
      {others.length > 0 && (
        <span className="mt-3 flex items-center gap-2.5 rounded-lg bg-muted/60 px-3 py-2">
          <AvatarStack people={others} size={22} />
          <span className="text-sm">{who}</span>
        </span>
      )}
      <span className="mt-3 block">They can read it, open its charts and conversations, and continue in their own copy. Only you can keep asking in it.</span>
      <span className="mt-3 flex items-center gap-1.5 text-sm font-medium text-foreground"><Warning size={15} className="text-warn" aria-hidden /> Sharing can’t be undone.</span>
    </ConfirmAction>
  )
}

/** A teammate's shared chat: read it, then carry on in a private copy. */
function ReadOnly({ t, onCopy }: { t: AskThreadSummary; onCopy: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 pl-4 shadow-float">
      {t.owner && <Avatar p={t.owner} size={32} />}
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{t.owner?.name ?? 'A teammate'} shared this chat</p>
        <p className="text-sm text-ink-2">Only they can ask in it. Continue in your own copy to ask more: it keeps everything so far and is private to you.</p>
      </div>
      <Button onClick={async () => (setBusy(true), await onCopy(), setBusy(false))} disabled={busy}>
        <CopySimple aria-hidden /> {busy ? 'Copying…' : 'Continue in a copy'}
      </Button>
    </div>
  )
}
