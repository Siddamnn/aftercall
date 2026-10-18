// Docs search: searches inside every article, section by section, and says where each match is
// (article › heading) with a snippet, linking straight to the heading.
//
// How it ranks (the hybrid approach docs search services use):
// 1. Words: MiniSearch over each section's title, heading and text, with typos forgiven, prefixes
//    matched, and matches in titles and headings ranked higher.
// 2. Meaning: queries are widened with what people mean ("login" → sign in, session; "refund" →
//    credits, invoice), so a question finds the answer even in other words.
// 3. Semantic (B65): when the backend's GET /docs/search answers (embeddings over the same
//    sections), its ranking is merged with ours by reciprocal rank fusion. Without it, 1 and 2 serve.
// The index is built in the browser the first time someone searches, from the articles themselves,
// so it's never out of date.
import MiniSearch from 'minisearch'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ARTICLES, sectionOf } from './registry'

export interface DocHit {
  id: string
  slug: string
  article: string
  section: string
  heading: string | null
  anchor: string | null
  /** The matching text, with the words that matched between ‹ and ›. */
  snippet: string
}

interface Doc { id: string; slug: string; article: string; section: string; heading: string | null; anchor: string | null; text: string; keywords: string }

/** Everyday words → the words the docs use. Only widens a query; never replaces it. */
const MEANS: Record<string, string> = {
  login: 'sign in session', logout: 'sign out', signin: 'sign in', password: 'sign in link google',
  expired: 'session 5 hours sign in', timeout: 'session 5 hours', kicked: 'signed out session',
  price: 'pricing cost credits plan', cost: 'pricing tokens credits', pay: 'credits top-up payment', payment: 'credits top-up invoice',
  refund: 'credits invoice cancel', cancel: 'cancel pro plan', invoice: 'invoices credits', bill: 'billing credits invoice', billing: 'credits plan invoice',
  money: 'credits currency', rupees: 'currency inr', euro: 'currency eur', coupon: 'discount code', promo: 'discount promotion',
  question: 'signal', questions: 'signals trackers', category: 'tracker', categories: 'trackers',
  upload: 'analyse file conversations', file: 'upload formats csv json', transcript: 'conversation transcripts formats',
  call: 'conversation', calls: 'conversations', chat: 'conversation alteria', format: 'csv json jsonl text vtt srt',
  accuracy: 'confidence review', wrong: 'confidence review', sure: 'confidence', trust: 'confidence review',
  team: 'members invite roles', teammate: 'invite members', colleague: 'invite members', permission: 'roles',
  permissions: 'roles owner admin member viewer', access: 'roles permissions', user: 'member people',
  delete: 'delete remove data', remove: 'delete', gdpr: 'privacy rights data', data: 'privacy data delete',
  ai: 'alteria', assistant: 'alteria', report: 'dashboard export', download: 'export csv pdf png',
  limit: 'allowance limit plan', budget: 'allowance', spend: 'usage allowance credits',
  alert: 'notifications', notify: 'notifications', email: 'notifications invite',
  api: 'api developer endpoint', developer: 'api', key: 'api keys authentication', token: 'tokens credits api key',
  hack: 'security vulnerability', bug: 'support security', help: 'support contact', contact: 'support email',
}
const widen = (q: string) => {
  const words = q.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return [...new Set([...words, ...words.flatMap((w) => (MEANS[w] ?? '').split(' ').filter(Boolean))])].join(' ')
}

let built: Promise<{ mini: MiniSearch<Doc>; docs: Map<string, Doc> }> | undefined

/** Render every article, and cut it into sections at its headings. */
async function buildIndex() {
  const docs: Doc[] = []
  const pages = ARTICLES.map((x) => ({ slug: x.slug, title: x.title, section: sectionOf(x.section).title, keywords: x.keywords, description: x.description, load: x.load }))
  for (const x of pages) {
    const Body = await x.load()
    let html = ''
    try {
      html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Body)))
    } catch {
      // An article that can't render on its own: its title and description still find it.
    }
    const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body
    const base = { slug: x.slug, article: x.title, section: x.section, keywords: `${x.keywords ?? ''} ${x.description}` }
    let cur: Doc = { ...base, id: x.slug, heading: null, anchor: null, text: '' }
    const push = () => {
      if (cur.text.trim() || cur.heading) docs.push(cur)
    }
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n instanceof HTMLElement && n.tagName === 'H2' && n.id) {
        push()
        const heading = n.dataset.toc ?? n.textContent ?? ''
        cur = { ...base, id: `${x.slug}#${n.id}`, heading, anchor: n.id, text: '' }
        continue
      }
      // Code samples ([data-search-skip]) would fill snippets with syntax; the prose around them says what they do.
      if (n.nodeType === Node.TEXT_NODE && !n.parentElement?.closest('h2, [data-search-skip]')) cur.text += `${n.textContent} `
    }
    push()
  }
  const mini = new MiniSearch<Doc>({
    fields: ['article', 'heading', 'text', 'keywords'],
    storeFields: ['id'],
    searchOptions: { boost: { article: 3, heading: 2.5, keywords: 1.5 }, fuzzy: 0.2, prefix: true, combineWith: 'OR' },
  })
  const unique = [...new Map(docs.map((d) => [d.id, { ...d, text: d.text.replace(/\s+/g, ' ').trim() }])).values()]
  mini.addAll(unique)
  return { mini, docs: new Map(unique.map((d) => [d.id, d])) }
}

/** Start building the index before the first keystroke lands (on focus). */
export const warmDocSearch = () => void (built ??= buildIndex())

/** Words too common to highlight. */
const STOP = new Set(['the', 'and', 'for', 'was', 'why', 'how', 'what', 'who', 'can', 'does', 'are', 'you', 'your', 'with', 'this', 'that', 'from', 'when', 'where', 'which', 'mean', 'means'])

function snippet(text: string, words: string[], width = 150) {
  const lower = text.toLowerCase()
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 50)
  let s = (start ? '…' : '') + text.slice(start, start + width).trim() + (start + width < text.length ? '…' : '')
  for (const w of words.filter((w) => w.length > 2 && !STOP.has(w))) s = s.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]*)`, 'gi'), '‹$1›')
  return s
}

/** The backend's semantic search (B65), when it exists. Ranked section ids, best first. */
async function semantic(q: string): Promise<string[]> {
  if (import.meta.env.VITE_API_MOCK === 'true') return []
  try {
    const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'
    const res = await fetch(`${base}/docs/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(1200) })
    if (!res.ok) return []
    return ((await res.json()) as { id: string }[]).map((r) => r.id)
  } catch {
    return []
  }
}

export async function searchDocs(q: string, limit = 10): Promise<DocHit[]> {
  const query = q.trim()
  if (!query) return []
  const { mini, docs } = await (built ??= buildIndex())
  const [local, remote] = await Promise.all([Promise.resolve(mini.search(widen(query)).map((r) => r.id as string)), semantic(query)])
  // Reciprocal rank fusion: each list votes 1/(60 + rank); the query's own words decide ties.
  const score = new Map<string, number>()
  for (const list of [local, remote]) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + i)))
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => docs.get(id))
    .filter((d): d is Doc => !!d)
    .slice(0, limit)
    .map((d) => ({ id: d.id, slug: d.slug, article: d.article, section: d.section, heading: d.heading, anchor: d.anchor, snippet: snippet(d.text || d.keywords, words) }))
}
