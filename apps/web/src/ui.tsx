import NumberFlow, { type Format } from '@number-flow/react'
import { CheckSquare, Desktop, Gauge, ListBullets, Moon, Sun, WarningCircle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { SignalType } from './api'
import { typeLabel } from './lib/format'
import { Button } from './components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './components/ui/sheet'
import { ease, rise } from './lib/motion'
import { cn } from './lib/utils'
import { setTheme, useTheme, type Theme } from './theme'

/** A number that rolls digit by digit when it changes. */
export function Num({ value, className, format }: { value: number; className?: string; format?: Format }) {
  return <NumberFlow value={value} format={format} className={cn('tabular-nums', className)} willChange />
}

const ICONS: Record<SignalType, typeof ListBullets> = { choice: ListBullets, yes_no: CheckSquare, score: Gauge }

export function TypeTag({ type, className }: { type: SignalType; className?: string }) {
  const Icon = ICONS[type]
  const label = typeLabel(type)
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[0.75rem] font-medium text-ink-2', className)}>
      <Icon size={12} weight="bold" aria-hidden />
      {label}
    </span>
  )
}

/** Identifiers people match against files and exports (call IDs, CSV keys) are set in mono. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[0.92em] tracking-tight', className)}>{children}</span>
}

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[62ch]">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{title}</h1>
        {children && <p className="mt-1.5 text-ink-2">{children}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Shakes once when it appears, so an error is noticed without being loud. */
export function ErrorNote({ children, onRetry, className }: { children: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <motion.div
      role="alert"
      initial={{ x: 0 }}
      animate={{ x: [0, -6, 6, -4, 4, 0] }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      className={cn('flex items-start gap-3 rounded-xl border border-stop/25 bg-stop-soft p-4 text-sm', className)}
    >
      <WarningCircle size={20} className="mt-px shrink-0 text-stop" weight="fill" aria-hidden />
      <div className="flex-1 leading-relaxed">{children}</div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </motion.div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <motion.div {...rise} className="surface flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-11 place-items-center rounded-xl border bg-muted text-muted-foreground">{icon}</div>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-[46ch] text-ink-2">{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}

/** Segmented control; the selected pill slides between options. */
export function Segmented<T extends string>({ id, options, value, onChange, label, className }: {
  id: string
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted/70 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative isolate rounded-[6px] px-2.5 py-1 text-[0.8125rem] font-medium transition-colors duration-150',
              on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[6px] border bg-card shadow-panel"
                transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.12 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Thin confidence bar; amber when the answer needs review. */
export function Meter({ value, review, className }: { value: number; review?: boolean; className?: string }) {
  return (
    <span className={cn('relative block h-1 w-full overflow-hidden rounded-full bg-muted', className)} aria-hidden>
      <motion.span
        className={cn('absolute inset-y-0 left-0 origin-left rounded-full', review ? 'bg-warn' : 'bg-primary')}
        style={{ width: '100%' }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: value > 0 ? Math.max(value, 0.02) : 0 }}
        transition={{ duration: 0.5, ease }}
      />
    </span>
  )
}

/** Right-side panel (Radix sheet): focus trap, Escape and inert background come with it. */
export function SidePanel({ open, onClose, title, subtitle, children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader className="border-b px-6 pt-5 pb-4">
          <SheetTitle className="truncate pr-10 text-lg font-semibold tracking-[-0.02em]">{title}</SheetTitle>
          <SheetDescription className={subtitle ? '' : 'sr-only'}>{subtitle || 'Details'}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
        {footer && <SheetFooter className="flex-row items-center justify-end border-t px-6 py-4">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Match system', Icon: Desktop },
]

/** One button; the menu holds light, dark and system. The icon swaps with a quick blur. */
export function ThemeButton({ className, align = 'end' }: { className?: string; align?: 'start' | 'end' }) {
  const theme = useTheme()
  const current = THEMES.find((t) => t.value === theme)!
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn('text-muted-foreground hover:text-foreground', className)} aria-label={`Theme: ${current.label}`} title="Theme">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={theme}
              className="grid place-items-center"
              initial={{ opacity: 0, scale: 0.6, filter: 'blur(3px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.6, filter: 'blur(3px)', transition: { duration: 0.1 } }}
              transition={{ duration: 0.2, ease }}
            >
              <current.Icon size={17} aria-hidden />
            </motion.span>
          </AnimatePresence>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden /> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
