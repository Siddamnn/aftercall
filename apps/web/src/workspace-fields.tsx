// The workspace's address field: HOST/ + the slug (config.ts), checked as you type.
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from './components/ui/input-group'
import { Loader } from './loaders'
import { HOST, useSlugCheck } from './lib/workspace'

/** Reports whether the address can be used through `onValid`, so the form can wait for it. */
export function SlugField({ id, value, onChange, current, onValid }: {
  id: string
  value: string
  onChange: (slug: string) => void
  current?: string
  onValid?: (ok: boolean) => void
}) {
  const s = useSlugCheck(value, current)
  const status = !value ? null : s.checking ? 'checking' : s.error ? 'error' : s.check && !s.check.available ? 'taken' : s.ok && value !== current ? 'free' : null
  const valid = s.ok && !s.checking
  useEffect(() => onValid?.(valid), [valid, onValid])
  return (
    <div>
      <InputGroup className="h-10 bg-card">
        <InputGroupAddon><InputGroupText className="text-muted-foreground">{HOST}/</InputGroupText></InputGroupAddon>
        <InputGroupInput
          id={id} value={value} spellCheck={false} autoCapitalize="none" autoComplete="off" maxLength={40}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          aria-invalid={status === 'error' || status === 'taken'} aria-describedby={`${id}-status`}
          className="pl-0.5 font-mono text-[0.875rem]"
        />
        <InputGroupAddon align="inline-end">
          <AnimatePresence mode="popLayout" initial={false}>
            {status === 'checking' && <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Loader size={14} label="Checking" /></motion.span>}
            {status === 'free' && <motion.span key="f" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.4 }}><CheckCircle size={16} weight="fill" className="text-ok" aria-hidden /></motion.span>}
            {(status === 'taken' || status === 'error') && <motion.span key="t" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}><WarningCircle size={16} weight="fill" className="text-stop" aria-hidden /></motion.span>}
          </AnimatePresence>
        </InputGroupAddon>
      </InputGroup>
      <p id={`${id}-status`} className="mt-1.5 min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {status === 'free' && <span className="text-ok">Available</span>}
        {status === 'error' && <span className="text-stop">{s.error}</span>}
        {status === 'taken' && (
          <span className="text-stop">
            Taken.{' '}
            {s.check?.suggestion && (
              <button type="button" onClick={() => onChange(s.check!.suggestion!)} className="font-medium text-primary hover:underline">
                Use {s.check.suggestion}
              </button>
            )}
          </span>
        )}
        {!status && 'Your team’s address. Lowercase letters, numbers and dashes.'}
      </p>
    </div>
  )
}
