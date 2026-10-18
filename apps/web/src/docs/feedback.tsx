// Two small pieces of the help centre, mounted by pages/Docs.tsx:
// - Helpful: "Was this helpful?" at the end of an article. Yes is one click; No asks what was
//   missing. Sent to the backend (B65) so we know which articles to fix. One answer per article
//   per browser.
// - Continue: "Pick up where you left off" on the docs landing, from the last article opened.
import { ArrowRight, ThumbsDown, ThumbsUp } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sendDocFeedback, type ApiError } from '../api'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { Loader } from '../loaders'
import { ease } from '../lib/motion'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'
import { articleBySlug } from './registry'

const read = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null')
  } catch {
    return null
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    // Not remembered; fine.
  }
}

const VOTED = 'docs-voted'
const LAST = 'docs-last'

export function Helpful({ slug }: { slug: string }) {
  const [voted, setVoted] = useState<boolean | null>(() => read<Record<string, boolean>>(VOTED)?.[slug] ?? null)
  const [asking, setAsking] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setVoted(read<Record<string, boolean>>(VOTED)?.[slug] ?? null)
    setAsking(false)
    setComment('')
  }, [slug])

  const send = async (helpful: boolean, note?: string) => {
    setBusy(true)
    try {
      await sendDocFeedback(slug, helpful, note)
      write(VOTED, { ...read<Record<string, boolean>>(VOTED), [slug]: helpful })
      setVoted(helpful)
      setAsking(false)
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Feedback" className="mt-10 max-w-[72ch] rounded-xl border px-4 py-3">
      <AnimatePresence mode="wait" initial={false}>
        {voted !== null ? (
          <motion.p key="thanks" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }} className="text-sm text-ink-2" role="status">
            {voted ? 'Thanks! Glad it helped.' : 'Thanks for telling us. We’ll use it to improve this page.'}
          </motion.p>
        ) : asking ? (
          <motion.form key="ask" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }} onSubmit={(e) => (e.preventDefault(), void send(false, comment))}>
            <label htmlFor="doc-missing" className="text-sm font-medium">What was missing or unclear?</label>
            <Textarea id="doc-missing" autoFocus value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} placeholder="Optional. Don’t include personal details." className="mt-2 bg-card" />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => void send(false)} disabled={busy}>Skip</Button>
              <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader /> : 'Send'}</Button>
            </div>
          </motion.form>
        ) : (
          <motion.div key="q" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Was this helpful?</span>
            <span className="flex gap-2">
              {[{ yes: true, Icon: ThumbsUp, label: 'Yes' }, { yes: false, Icon: ThumbsDown, label: 'No' }].map(({ yes, Icon, label }) => (
                <Button key={label} variant="outline" size="sm" disabled={busy} onClick={() => (yes ? void send(true) : setAsking(true))}
                  className={cn('bg-card transition-transform active:scale-[0.96]')}>
                  <Icon aria-hidden /> {label}
                </Button>
              ))}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Remember the article being read, for "Pick up where you left off". */
export const rememberArticle = (slug: string) => write(LAST, { slug, at: Date.now() })

/** On the docs landing: the last article opened in the past two weeks. */
export function Continue() {
  const last = read<{ slug: string; at: number }>(LAST)
  const x = last && Date.now() - last.at < 14 * 86_400_000 ? articleBySlug(last.slug) : undefined
  if (!x) return null
  return (
    <p className="mt-3 text-sm">
      <Link to={`/docs/${x.slug}`} className="group inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-ink-2 shadow-panel transition-colors hover:text-foreground">
        Pick up where you left off: <b className="font-medium text-foreground">{x.title}</b>
        <ArrowRight size={12} className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </p>
  )
}
