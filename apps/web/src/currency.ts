// Money on screen (B55). The backend keeps every amount in US dollars. It also says which currency to
// show, picked from where the visitor is (or the workspace's own choice) with the rate to use, and
// the payment provider charges in that currency at that rate. So the UI converts only for display.
import type { Format } from '@number-flow/react'
import type { DisplayCurrency } from './api'

let current: DisplayCurrency = { code: 'USD', rate: 1, country: null, source: 'default' }
const listeners = new Set<() => void>()

export const setDisplayCurrency = (c: DisplayCurrency | undefined | null) => {
  const next = c ?? { code: 'USD', rate: 1, country: null, source: 'default' }
  if (next.code === current.code && next.rate === current.rate) return
  current = next
  listeners.forEach((l) => l())
}
export const displayCurrency = () => current
export const onCurrency = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

const small = (n: number) => n !== 0 && Math.abs(n) < 1

/** Intl options for a converted amount: whole units stay whole, cents when there are some, and
 *  small amounts keep up to 4 decimals so a run's cost never shows as 0. */
export function moneyFormat(local: number): Format {
  const whole = Number.isInteger(local)
  return { style: 'currency', currency: current.code, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: small(local) ? 4 : 2 }
}

/** A dollar amount, in the display currency: "$49", "₹4,067", "€0.0042". */
export function formatMoney(usd: number) {
  const local = usd * current.rate
  return new Intl.NumberFormat(undefined, moneyFormat(local)).format(local)
}

/** For <Num>: the converted value and its format, so the number still animates. */
export const numMoney = (usd: number) => ({ value: usd * current.rate, format: moneyFormat(usd * current.rate) })

/** "Prices in INR, from USD at ₹83.10" when it isn't dollars; null when it is. */
export function currencyNote() {
  if (current.code === 'USD') return null
  const one = new Intl.NumberFormat(undefined, { style: 'currency', currency: current.code, maximumFractionDigits: 2 }).format(current.rate)
  return `Prices in ${current.code}, from US dollars at ${one} = $1.`
}

// ── Amounts people type ────────────────────────────────────────────────────────
// Inputs take the display currency, and the API gets US dollars: what you type is what you pay.

/** "$", "₹", "€": the display currency's symbol, for an input's prefix. */
export function currencySymbol() {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: current.code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0).find((p) => p.type === 'currency')?.value ?? current.code
}
/** USD → the display currency, rounded to cents, for an input's value. */
export const toLocal = (usd: number) => Math.round(usd * current.rate * 100) / 100
/** What someone typed, in the display currency → USD for the API. */
export const fromLocal = (local: number) => Math.round((local / current.rate) * 1e6) / 1e6
/** A dollar preset as a clean local amount: $25 in rupees is ₹2,000, not ₹2,077.50. Returns USD. */
export function nicePreset(usd: number) {
  const local = usd * current.rate
  const step = 10 ** Math.max(0, Math.floor(Math.log10(local)) - 1)
  return fromLocal(Math.round(local / step) * step)
}
