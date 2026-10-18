// The two plans (B40), in one place: the pricing page, the plan meter and feature gates read this.
// Everything runs on prepaid credits, charged per token. Pay as you go charges tokens at the
// standard rate. Pro takes a monthly fee from credits, includes a token allowance and alteria,
// and charges tokens above the allowance at a lower rate.
//
// The numbers come from the backend (GET /billing), never from here: until a price is set there,
// the page says "Price soon". This file holds the words and the feature split.

import { formatMoney } from './currency'
import type { BillingPlan, PlanId } from './api'

export type { PlanId }

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  cta: string
  /** Projects the plan allows (B37's project_limit). */
  projects: number
  highlights: string[]
}

export const PLANS: Plan[] = [
  {
    id: 'payg',
    name: 'Pay as you go',
    tagline: 'Load credits, pay for the tokens you use',
    cta: 'Add credits',
    projects: 5,
    highlights: [
      'A trial credit to start, on your own conversations',
      'Every signal type, conditional trackers',
      'Insights and dashboards',
      'Every single export: a run, a chart, a chat, a page as CSV, PNG, PDF or Markdown',
      '5 projects, 3 teammates, unlimited viewers',
      '20 alteria drafts to try it',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For teams who check their conversations every week',
    cta: 'Start Pro',
    projects: 25,
    highlights: [
      'Everything in pay as you go, plus:',
      'Tokens included every month, and a lower rate above them',
      'alteria drafts trackers and signals from a sentence',
      'Ask alteria: chat with every conversation in a project',
      'Share chats with your team',
      'Bulk exports: every conversation in a view, every chart in a dashboard, many chats in one .zip',
      '25 projects, unlimited teammates, no fee per seat',
      'Scheduled reports and alerts (soon)',
      'API and webhooks (soon)',
    ],
  },
]

export const planOf = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0]
export const isPro = (id?: PlanId) => id === 'pro'

/** "$0.50 per 1M tokens", or null while the backend hasn't set the price. */
export const rateLabel = (p?: BillingPlan) => (p?.price_per_million_tokens == null ? null : `${usd(p.price_per_million_tokens)} per 1M tokens`)
/** A USD amount in the display currency (currency.ts, B55): $49, ₹4,067, €0.0042. Whole amounts stay
 *  whole, and small ones keep what matters. The name is kept because amounts are USD going in. */
export const usd = (n: number) => formatMoney(n)
export const tokensLabel = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

type Cell = boolean | string
export interface FeatureRow { label: string; hint?: string; soon?: boolean; payg: Cell; pro: Cell }

/** The comparison table. `soon` marks what isn't built yet, so nothing is oversold. */
export const FEATURES: { group: string; rows: FeatureRow[] }[] = [
  {
    group: 'Analyse',
    rows: [
      { label: 'Billing', hint: 'Prepaid credits. A run holds its estimate, then is charged what it used', payg: 'Per token', pro: 'Monthly fee, tokens included' },
      { label: 'Tokens above what’s included', payg: 'Standard rate', pro: 'Lower rate' },
      { label: 'Trackers and signals', hint: 'Yes or no, pick one, and score', payg: 'Unlimited', pro: 'Unlimited' },
      { label: 'Conditional trackers', hint: 'Run a tracker only when another answer says so, to save tokens', payg: true, pro: true },
      { label: 'Confidence on every answer and a review queue', payg: true, pro: true },
      { label: 'Review corrections and measured accuracy', soon: true, payg: false, pro: true },
    ],
  },
  {
    group: 'alteria',
    rows: [
      { label: 'Any transcript layout', hint: 'CSV, JSON, JSONL, plain text, VTT and SRT, read as they are', payg: true, pro: true },
      { label: 'Draft trackers and signals from a sentence', payg: '20 drafts to try', pro: true },
      { label: 'Ask alteria: chat with your conversations', hint: 'Answers with charts and the conversations behind them', payg: '3 questions to try', pro: true },
      { label: 'Convert PDF, Word, WhatsApp and Slack exports', hint: 'alteria turns documents and chat exports into conversations to analyse', soon: true, payg: false, pro: true },
    ],
  },
  {
    group: 'Chats',
    rows: [
      { label: 'Saved chats: search, rename, pin', hint: 'Every chat is kept per project, private to you', payg: true, pro: true },
      { label: 'Export a chat as Markdown or PDF', hint: 'The questions, answers, charts and the conversations behind them', payg: true, pro: true },
      { label: 'Select many: delete, pin', payg: true, pro: true },
      { label: 'Share chats with the team', hint: 'Teammates read them and carry on in their own copy. Sharing can’t be undone', payg: false, pro: true },
      { label: 'Bulk share', payg: false, pro: true },
    ],
  },
  {
    group: 'Understand',
    rows: [
      { label: 'Insights and dashboards', payg: true, pro: true },
      { label: 'Trend with agent-version markers, and compare', payg: true, pro: true },
    ],
  },
  {
    group: 'Export',
    rows: [
      { label: 'A run’s results as CSV', hint: 'Every answer and confidence, for one upload', payg: true, pro: true },
      { label: 'A chart as CSV or PNG', payg: true, pro: true },
      { label: 'Insights or a dashboard as PNG or PDF', payg: true, pro: true },
      { label: 'Insights summary as CSV', hint: 'Every card’s numbers, with the view’s filters', payg: true, pro: true },
      { label: 'A chat as Markdown or PDF', payg: true, pro: true },
      { label: 'Every conversation in a view as CSV', hint: 'All uploads at once, filtered, with every answer', payg: false, pro: true },
      { label: 'A whole dashboard as CSV', hint: 'One table per chart, in order', payg: false, pro: true },
      { label: 'Many chats in one .zip', payg: false, pro: true },
    ],
  },
  {
    group: 'Share and act',
    rows: [
      { label: 'In-app notifications', hint: 'Finished runs, shared chats, low credits, new teammates', payg: true, pro: true },
      { label: 'Scheduled reports by email', soon: true, payg: false, pro: true },
      { label: 'Alerts to Slack, email or a webhook', soon: true, payg: false, pro: true },
      { label: 'API and webhooks', soon: true, payg: false, pro: true },
    ],
  },
  {
    group: 'Team',
    rows: [
      { label: 'Projects', payg: '5', pro: '25' },
      { label: 'Teammates who ask and analyse', hint: 'No per-seat fees on either plan', payg: '3', pro: 'Unlimited' },
      { label: 'Viewers', hint: 'Read Insights, dashboards and shared chats, and ask alteria within an allowance. Free seats', payg: 'Unlimited, free', pro: 'Unlimited, free' },
      { label: 'Allowances per role and per person', hint: 'Members 50%, viewers 25% of the monthly budget by default', payg: true, pro: true },
      { label: 'Roles: owner, admin, member, viewer', payg: true, pro: true },
      { label: 'Join by email domain', hint: 'Anyone at your company’s domain finds the workspace and joins', payg: true, pro: true },
      { label: 'Audit log', hint: 'Who shared, deleted, invited or topped up, and when', soon: true, payg: false, pro: true },
    ],
  },
]
