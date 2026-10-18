// alteria's mark, on its own so the landing page can use it without the app.
import { motion } from 'motion/react'
import { cn } from './lib/utils'

/** alteria's mark: a simple "o" holding a three-line wave (the landing page's voice wave).
 *  The wave moves while alteria works, and rests otherwise. */
export function AlteriaMark({ size = 16, active = false, className }: { size?: number; active?: boolean; className?: string }) {
  const bars: [number, number][] = [[8.5, 0.55], [12, 1], [15.5, 0.7]]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
      {bars.map(([x, h], i) => (
        <motion.line
          key={x} x1={x} x2={x} y1={12 - 4 * h} y2={12 + 4 * h} stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={active ? { scaleY: [1, 0.35, 1.15, 0.6, 1] } : { scaleY: 1 }}
          transition={active ? { duration: 1.1 + i * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 } : { duration: 0.3 }}
        />
      ))}
    </svg>
  )
}
