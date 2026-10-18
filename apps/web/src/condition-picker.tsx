// "Only run if…": pick another tracker's signal, a comparison that fits its type, and the answers.
// Used in the new-tracker wizard and in the tracker menu's condition dialog.
import { Check, GitBranch } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { Condition, Tracker } from './api'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './components/ui/select'
import { Switch } from './components/ui/switch'
import { answersOf, conditionError, describe, findSignal, opsFor } from './conditions'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { title } from './signal-draft'
import { Segmented } from './ui'

export function ConditionPicker({ self, trackers, value, onChange, showErrors }: {
  /** The tracker the condition is for. Empty while a new one has no name yet. */
  self: string
  trackers: Tracker[]
  value: Condition | null
  onChange: (c: Condition | null) => void
  showErrors?: boolean
}) {
  // Gates can be any active signal in another tracker.
  const gates = trackers.filter((t) => t.name !== self && t.signals.some((s) => s.active))
  const signal = value && findSignal(trackers, value)
  const answers = signal ? answersOf(signal.spec) : []
  const error = showErrors ? conditionError(value, self, trackers) : undefined

  const pick = (key: string) => {
    const [tracker, name] = key.split('.')
    const s = findSignal(trackers, { tracker, signal: name })!
    const op = opsFor(s.spec)[0].op
    onChange({ tracker, signal: name, op, value: s.spec.type === 'score' ? Math.max(0, answersOf(s.spec).length - 2) : [] })
  }
  const toggleAnswer = (v: string) => {
    if (!value || !Array.isArray(value.value)) return
    const has = value.value.includes(v)
    onChange({ ...value, value: has ? value.value.filter((x) => x !== v) : [...value.value, v] })
  }

  if (!gates.length) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <GitBranch size={16} className="mt-px shrink-0" aria-hidden />
        Once you have another tracker with signals, this one can run only when that tracker's answer matches.
      </p>
    )
  }

  return (
    <div className="rounded-xl border">
      <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <GitBranch size={18} className={cn('shrink-0 transition-colors duration-150', value ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
        <span className="flex-1">
          <span className="block text-sm font-medium">Only run if…</span>
          <span className="block text-sm text-muted-foreground">
            {!value ? 'Runs on every call unless you set a condition.'
              : signal && !conditionError(value, self, trackers) ? `Runs when ${describe(value, trackers)}.`
              : 'Pick the answers it should run on.'}
          </span>
        </span>
        <Switch
          checked={!!value}
          onCheckedChange={(on) => (on ? pick(`${gates[0].name}.${gates[0].signals.find((s) => s.active)!.name}`) : onChange(null))}
          aria-label="Only run if another tracker's answer matches"
        />
      </label>

      <AnimatePresence initial={false}>
        {value && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { height: { duration: 0.25, ease }, opacity: { duration: 0.2, delay: 0.05 } } }}
            exit={{ height: 0, opacity: 0, transition: { height: { duration: 0.15, ease }, opacity: { duration: 0.1 } } }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={`${value.tracker}.${value.signal}`} onValueChange={pick}>
                  <SelectTrigger className="h-9 min-w-56 bg-card" aria-label="Signal the condition is on">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gates.map((t) => (
                      <SelectGroup key={t.name}>
                        <SelectLabel>{title(t.name)}</SelectLabel>
                        {t.signals.filter((s) => s.active).map((s) => (
                          <SelectItem key={s.name} value={`${t.name}.${s.name}`}>{title(s.name)}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {signal && (
                  <Segmented
                    id="cond-op"
                    label="Comparison"
                    value={value.op}
                    onChange={(op) => onChange({ ...value, op })}
                    options={opsFor(signal.spec).map((o) => ({ value: o.op, label: o.label }))}
                  />
                )}
              </div>

              {signal && (
                <ul className="flex flex-wrap gap-2" aria-label={signal.spec.type === 'score' ? 'Level' : 'Answers'}>
                  {answers.map((a) => {
                    const on = Array.isArray(value.value) ? value.value.includes(a.value) : String(value.value) === a.value
                    return (
                      <li key={a.value}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => (Array.isArray(value.value) ? toggleAnswer(a.value) : onChange({ ...value, value: Number(a.value) }))}
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]',
                            on ? 'border-primary/50 bg-primary-soft text-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {on && <Check size={12} weight="bold" className="text-primary" aria-hidden />}
                          {a.label}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <AnimatePresence initial={false}>
                {error && (
                  <motion.p key="e" role="alert" className="text-sm text-stop" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
