import type { SignalType } from '../api'
import { formatMoney } from '../currency'

export const num = (n: number) => n.toLocaleString('en-US')
export const pct = (p: number) => `${Math.round(p * 100)}%`
/** A USD amount, in the display currency (currency.ts). */
export const money = (n: number) => formatMoney(n)
export const humanize = (s: string) => s.replaceAll('_', ' ')
export const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

const TYPE_LABELS: Record<SignalType, string> = { choice: 'Pick one', yes_no: 'Yes or no', score: 'Score' }
export const typeLabel = (t: SignalType) => TYPE_LABELS[t]
export { title } from '../signal-draft'

const CHANNELS: Record<string, string> = { call: 'Call', chat: 'Chat', email: 'Email', voice_agent: 'Voice agent' }
/** B6 channels are free text; the common ones get a proper label. */
export const channelLabel = (c: string) => CHANNELS[c] ?? humanize(c).replace(/^./, (x) => x.toUpperCase())
