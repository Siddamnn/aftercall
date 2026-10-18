// Conditional trackers ("only run if…"): the backend's rules (_check_condition, _condition_problem
// and _resolve_trackers in apps/backend/aftercall/api.py), mirrored so the UI can show problems
// before saving, pick gate trackers, and say conditions in plain words.
import type { Condition, ConditionCheck, ConditionOp, Signal, SignalSpec, Tracker } from './api-types'
import { title } from './signal-draft'

export const OPS: Record<'set' | 'score', { op: ConditionOp; label: string }[]> = {
  set: [{ op: 'in', label: 'is' }, { op: 'not_in', label: 'is not' }],
  score: [{ op: 'gte', label: 'is at least' }, { op: 'lte', label: 'is at most' }],
}
export const opsFor = (spec: SignalSpec) => OPS[spec.type === 'score' ? 'score' : 'set']

/** The answers a signal can give, as condition values: option keys, yes / no, or score levels. */
export function answersOf(spec: SignalSpec): { value: string; label: string }[] {
  if (spec.type === 'choice') return Object.keys(spec.criteria ?? {}).map((k) => ({ value: k, label: title(k) }))
  if (spec.type === 'yes_no') return [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
  return ((spec.criteria as string[] | undefined) ?? []).map((l, i) => ({ value: String(i), label: `${i} ${l.split(':')[0]}` }))
}

export const findSignal = (trackers: Tracker[], c: Pick<Condition, 'tracker' | 'signal'>): Signal | undefined =>
  trackers.find((t) => t.name === c.tracker)?.signals.find((s) => s.name === c.signal)

/** How an answer to the condition's signal reads: "Declined", "Yes", "3 Angry". */
function answerLabel(c: Pick<Condition, 'tracker' | 'signal'>, v: string, trackers: Tracker[]) {
  const spec = findSignal(trackers, c)?.spec
  return (spec ? answersOf(spec).find((a) => a.value === v)?.label : undefined) ?? title(v)
}

/** "Call outcome is Declined or Price", "Frustration is at least 3 Angry". */
export function describe(c: Condition, trackers: Tracker[] = []): string {
  const op = [...OPS.set, ...OPS.score].find((o) => o.op === c.op)!.label
  const label = (v: string) => answerLabel(c, v, trackers)
  const value = Array.isArray(c.value)
    ? new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(c.value.map(label))
    : label(String(c.value))
  return `${title(c.signal)} ${op} ${value}`
}

/** Why the backend would refuse this condition on tracker `self`, or undefined if it's fine. */
export function problem(c: Condition, self: string, trackers: Tracker[]): string | undefined {
  if (c.tracker === self) return 'Pick a signal in another tracker.'
  const s = findSignal(trackers, c)
  if (!s) return 'That signal no longer exists.'
  if (!opsFor(s.spec).some((o) => o.op === c.op)) return 'That comparison doesn\'t fit this signal.'
  if (Array.isArray(c.value)) {
    if (!c.value.length) return 'Pick at least one answer.'
    const allowed = answersOf(s.spec).map((a) => a.value)
    if (c.value.some((v) => !allowed.includes(v))) return `${title(c.signal)} can't give one of those answers.`
  } else if (!Number.isFinite(c.value)) return 'Pick a level.'
  // Following the chain up from the gate must not come back to this tracker.
  const seen = new Set([self])
  for (let at = trackers.find((t) => t.name === c.tracker); at?.run_if; at = trackers.find((t) => t.name === at!.run_if!.tracker)) {
    if (seen.has(at.name) || at.run_if.tracker === self) return `${title(c.tracker)} already depends on ${title(self)}, so this would go round in a loop.`
    seen.add(at.name)
  }
}

/** The problem with a condition being built, if any; null means "always runs". */
export const conditionError = (c: Condition | null, self: string, trackers: Tracker[]) => (c ? problem(c, self, trackers) : undefined)

/** The trackers `name` needs to run alongside it: its gate, the gate's gate, and so on. */
export function gatesOf(name: string, trackers: Tracker[]): string[] {
  const out: string[] = []
  for (let t = trackers.find((x) => x.name === name); t?.run_if && !out.includes(t.run_if.tracker); t = trackers.find((x) => x.name === t!.run_if!.tracker)) {
    out.push(t.run_if.tracker)
  }
  return out
}

/** Trackers whose condition is on `name` (or on its signal `signal`), directly or further down. */
export function dependentsOf(name: string, trackers: Tracker[], signal?: string, seen = new Set([name])): string[] {
  const direct = trackers
    .filter((t) => t.run_if?.tracker === name && (!signal || t.run_if.signal === signal) && !seen.has(t.name))
    .map((t) => t.name)
  direct.forEach((d) => seen.add(d))
  return [...new Set(direct.flatMap((d) => [d, ...dependentsOf(d, trackers, undefined, seen)]))]
}

/** Why a conditional tracker ran or didn't on one call, in plain words (the backend's `reason` uses keys). */
export function explain(check: ConditionCheck, trackers: Tracker[] = []): string {
  const c = check.run_if
  const gate = `${title(c.tracker)}: ${title(c.signal)}`
  if (check.value === null) {
    return /didn't run/.test(check.reason ?? '')
      ? `${title(c.tracker)} didn't run on this call, so this didn't either.`
      : `${gate} has no answer on this call.`
  }
  const v = check.value
  const was = answerLabel(c, typeof v === 'number' ? String(Math.round(v)) : v, trackers)
  return check.met
    ? `Ran because ${gate} was ${was}.`
    : `${gate} was ${was}, and this runs only when ${describe(c, trackers)}.`
}
