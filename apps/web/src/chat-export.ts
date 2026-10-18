// Exporting alteria chats (B44), done in the browser: one chat as Markdown, many as a .zip of
// Markdown files (Pro). PDF is the chat page printed, so its charts are drawn as they look.
import type { AskThread, Tracker } from './api'
import { autoTitle } from './dashboard/model'
import { fileSlug, saveBlob } from './lib/export'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** The chat as a readable document: every question and answer, the chart it drew, and the
 *  conversations each answer is based on. */
export function chatMarkdown(t: AskThread, project: string, trackers: Tracker[]): string {
  const out = [`# ${t.title}`, '']
  const meta = [`Project: ${project}`, `Started ${when(t.created_at)}`]
  if (t.owner) meta.push(`By ${t.owner.name}`)
  if (t.shared_at) meta.push(`Shared with the team ${when(t.shared_at)}`)
  if (t.copied_from) meta.push(`Copied from ${t.copied_from.by.name}’s “${t.copied_from.title}”`)
  out.push(`*${meta.join(' · ')}*`, '')
  for (const m of t.messages) {
    if (m.role === 'user') {
      out.push('---', '', `## ${m.text}`, '')
      if (m.scope.from && m.scope.to) out.push(`*${m.scope.from} to ${m.scope.to}*`, '')
      continue
    }
    if (m.error) {
      out.push(`> alteria couldn’t answer: ${m.error}`, '')
      continue
    }
    out.push(m.text, '')
    const a = m.answer
    if (a?.chart) out.push(`**Chart:** ${a.chart.widget.title ?? autoTitle(a.chart.widget, trackers)}`, '')
    if (a?.dashboard) {
      out.push(`**Dashboard draft: ${a.dashboard.name}**`, '')
      for (const w of a.dashboard.widgets) out.push(`- ${w.title ?? autoTitle(w, trackers)}`)
      out.push('')
    }
    if (a?.citations.length) {
      out.push('**Conversations behind this answer**', '')
      for (const c of a.citations) out.push(`- ${c.external_id ?? `Conversation ${c.call_id}`}: ${c.why}`)
      out.push('')
    }
    if (a?.suggest_signal) out.push(`*Suggested signal:* ${a.suggest_signal}`, '')
  }
  out.push('---', '', `*Exported from aftercall ${when(new Date().toISOString())}.*`, '')
  return out.join('\n')
}

export const markdownName = (t: Pick<AskThread, 'title'>) => `${fileSlug(t.title)}.md`

export const saveMarkdown = (md: string, filename: string) => saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), filename)

/** PDF through the browser's print dialog: the chat page has print styles that hide everything
 *  but the conversation. */
export function printChat(title: string) {
  const was = document.title
  document.title = title // the PDF's default file name
  addEventListener('afterprint', () => (document.title = was), { once: true })
  print()
}

// ── A .zip without a library ───────────────────────────────────────────────────
// Stored (not compressed): Markdown is small, and this keeps the bundle free of a zip dependency.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zip(files: { name: string; text: string }[]): Blob {
  const enc = new TextEncoder()
  const parts: (ArrayBuffer | Uint8Array<ArrayBuffer>)[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const used = new Set<string>()
  for (const f of files) {
    // Two chats with the same title get "-2", "-3".
    let name = f.name
    for (let i = 2; used.has(name); i++) name = f.name.replace(/(\.\w+)$/, `-${i}$1`)
    used.add(name)
    const n = enc.encode(name)
    const data = enc.encode(f.text)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, n.length, true)
    parts.push(local.buffer, n, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, n.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), n)
    offset += 30 + n.length + data.length
  }
  const size = central.reduce((a, b) => a + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}
