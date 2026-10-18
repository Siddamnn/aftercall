// Wizard state for one signal, and the same rules the backend enforces in
// apps/backend/aftercall/questions.py, so mistakes show up at each step, not as a 422.
import type { SignalSpec, SignalType } from './api'

export interface Draft {
  name: string // the key; the wizard derives it from a friendly name with slug()
  type: SignalType
  instructions: string
  options: { key: string; text: string }[] // choice
  yes: string // yes_no, optional
  no: string
  levels: string[] // score, lowest first
  threshold: number
}

export type Errors = Partial<Record<'name' | 'instructions' | 'criteria', string>>

export const blank = (type: SignalType = 'yes_no', name = ''): Draft => ({
  name,
  type,
  instructions: '',
  options: [{ key: '', text: '' }, { key: '', text: '' }, { key: 'other', text: 'None of the above fits' }],
  yes: '',
  no: '',
  levels: ['', '', ''],
  threshold: 0.6,
})

export function fromSpec(s: SignalSpec): Draft {
  const d = { ...blank(s.type, s.name), instructions: s.instructions, threshold: s.review_threshold ?? 0.6 }
  if (s.type === 'choice') d.options = Object.entries(s.criteria ?? {}).map(([key, text]) => ({ key: title(key), text }))
  if (s.type === 'score') d.levels = [...((s.criteria as string[]) ?? [])]
  if (s.type === 'yes_no' && s.criteria && !Array.isArray(s.criteria)) {
    d.yes = s.criteria.true ?? ''
    d.no = s.criteria.false ?? ''
  }
  return d
}

export function toSpec(d: Draft): SignalSpec {
  const spec: SignalSpec = { name: d.name.trim(), type: d.type, instructions: d.instructions.trim(), review_threshold: d.threshold }
  if (d.type === 'choice') spec.criteria = Object.fromEntries(d.options.map((o) => [slug(o.key), o.text.trim()]))
  if (d.type === 'score') spec.criteria = d.levels.map((l) => l.trim())
  if (d.type === 'yes_no') {
    const c = Object.fromEntries(
      [['true', d.yes.trim()], ['false', d.no.trim()]].filter(([, v]) => v),
    )
    if (Object.keys(c).length) spec.criteria = c
  }
  return spec
}

/** "Asked for a human?" → "asked_for_a_human": the key the API, results and CSV use. */
/** "no_answer" → "No answer": how keys read in the UI. slug() turns it back. */
export const title = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ')

export const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64).replace(/_+$/, '')

const NAME = /^[a-z][a-z0-9_]{0,63}$/

function nameError(name: string, what: 'signal' | 'tracker') {
  if (!name) return `Give the ${what} a name.`
  if (!NAME.test(name)) return 'Start the name with a letter.'
}

/** Same rules as the backend's tracker spec: the signal-name pattern, and no "__" (it
 *  separates tracker and signal in the keys sent to Jev; slug() never makes one). */
export function validateTracker(name: string, description: string, takenNames: string[] = []): { name?: string; description?: string } {
  const n = name.trim()
  const e: { name?: string; description?: string } = {}
  e.name = nameError(n, 'tracker')
  if (!e.name && n.includes('__')) e.name = 'Tracker names can\'t contain two underscores in a row.'
  if (!e.name && takenNames.includes(n)) e.name = 'You already have a tracker with this name.'
  if (!e.name) delete e.name
  if (description.length > 500) e.description = 'Keep the description under 500 characters.'
  return e
}

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/g

export function validate(d: Draft, takenNames: string[] = []): Errors {
  const e: Errors = {}
  const name = d.name.trim()
  const bad = nameError(name, 'signal')
  if (bad) e.name = bad
  else if (takenNames.includes(name)) e.name = 'This tracker already has a signal with this name.'

  if (!d.instructions.trim()) e.instructions = 'Say what the AI should listen for.'
  else if (d.instructions.length > 2000) e.instructions = 'Keep this under 2,000 characters.'

  if (d.type === 'choice') {
    const keys = d.options.map((o) => slug(o.key))
    if (d.options.length < 2) e.criteria = 'Add at least two answers.'
    else if (keys.some((k) => !k)) e.criteria = 'Every answer needs a name.'
    else if (new Set(keys).size !== keys.length) e.criteria = 'Two answers have the same name.'
    else if (!keys.includes('other')) e.criteria = 'Keep an "Other" answer, so calls that fit nothing have somewhere to go.'
    else if (d.options.some((o) => !o.text.trim())) e.criteria = 'Describe when to pick each answer. That\'s what makes results accurate.'
  }
  if (d.type === 'score') {
    if (d.levels.length < 2 || d.levels.length > 10) e.criteria = 'A score needs between 2 and 10 levels.'
    else if (d.levels.some((l) => !l.trim())) e.criteria = 'Describe every level.'
  }

  const texts = [d.instructions, ...(d.type === 'choice' ? d.options.map((o) => o.text) : d.type === 'score' ? d.levels : [d.yes, d.no])]
  const unfilled = [...new Set(texts.flatMap((t) => t.match(PLACEHOLDER) ?? []))]
  if (unfilled.length && !e.instructions) e.instructions = `Fill in ${unfilled.join(', ')} first.`
  return e
}
