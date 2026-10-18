import { cn } from './lib/utils'

/**
 * The aftercall mark: a magnifying glass whose left half is a phone handset (cobalt) and whose
 * right half and handle are the lens (ink), with the call's waveform inside. Same drawing as
 * public/brand/mark-*.svg and public/favicon.svg. Follows the theme through --foreground / --primary.
 */
/** The mark's parts, shared with the loaders (loaders.tsx) so they're always the same drawing. */
export const MARK = {
  lens: 'M32.87 17.16A13 13 0 0 1 32.87 42.43',
  handle: 'M40.92 40.92L46.77 46.77',
  handset:
    'M26.52 14.95A15.2 15.2 0 0 0 26.52 44.64Q28.9 44.97 29.04 42.57L29.27 38.58Q29.42 36.18 27.1 35.6A6.4 6.4 0 0 1 26.65 35.37C26.13 35.04 23.77 38.76 22.94 38.14A10.8 10.8 0 0 1 22.94 21.45C23.77 20.83 26.13 24.55 26.65 24.22A6.4 6.4 0 0 1 27.1 23.99Q29.42 23.41 29.27 21.01L29.04 17.02Q28.9 14.62 26.52 14.95Z',
  /** The waveform: [x, top, bottom] of each bar. */
  bars: [[27.71, 27.19, 32.39], [31.35, 24.59, 34.99], [34.99, 26.41, 33.17]] as [number, number, number][],
}

export function Mark({ size = 26, bars = true, className }: { size?: number; bars?: boolean; className?: string }) {
  return (
    <svg viewBox="12 12 40 40" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <path d={MARK.lens} fill="none" stroke="var(--foreground)" strokeWidth="4.4" strokeLinecap="round" />
      <path d={MARK.handle} stroke="var(--foreground)" strokeWidth="5.2" strokeLinecap="round" />
      <path d={MARK.handset} fill="var(--primary)" />
      {bars && (
        <path d={MARK.bars.map(([x, a, b]) => `M${x} ${a}V${b}`).join('')} stroke="var(--primary)" strokeWidth="1.95" strokeLinecap="round" />
      )}
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Mark size={28} />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.03em]">aftercall</span>
    </span>
  )
}

/** A quiet credit line for the sign-in screen and footers. */
export function BuiltOn({ className }: { className?: string }) {
  return <p className={cn('text-xs text-muted-foreground', className)}>Built on Google Cloud · Gemini · Firebase</p>
}
