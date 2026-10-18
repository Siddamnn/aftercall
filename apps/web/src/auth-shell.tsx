// The frame for pages outside the app: sign-in, onboarding, invites, and the status pages
// (not found, no access, something broke). The wordmark, the theme, and the page centred.
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Wordmark } from './brand'
import { useNoIndex } from './lib/hooks'
import { rise } from './lib/motion'
import { cn } from './lib/utils'
import { useTheme } from './theme'
import { ThemeButton } from './ui'
import { BILLING_ON, CONTACT } from './config'
import { toasterProps } from './lib/toast'

export function AuthShell({ children, aside, wide, footer = true }: { children: ReactNode; aside?: ReactNode; wide?: boolean; footer?: boolean }) {
  const theme = useTheme()
  useNoIndex()
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <div className={cn('min-h-dvh', aside && 'lg:grid lg:grid-cols-[1fr_minmax(0,34rem)]')}>
      <div className="flex min-h-dvh flex-col px-4 md:px-8">
        <header className="flex items-center justify-between py-4 md:py-6">
          <Link to="/" className="rounded-lg px-1 py-1" aria-label="aftercall home"><Wordmark /></Link>
          <ThemeButton />
        </header>
        <main className="grid flex-1 place-items-center py-8">
          <motion.div {...rise} className={cn('w-full', wide ? 'max-w-xl' : 'max-w-sm')}>{children}</motion.div>
        </main>
        {footer && (
          <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-5 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} aftercall</span>
            {BILLING_ON && <Link to="/pricing" className="hover:text-foreground">Pricing</Link>}
            <Link to="/docs" className="hover:text-foreground">Docs</Link>
            <Link to="/docs/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/docs/terms" className="hover:text-foreground">Terms</Link>
            <a href={`mailto:${CONTACT}`} className="hover:text-foreground">Contact</a>
            <span className="basis-full text-center">Built on Google Cloud · Gemini · Firebase</span>
          </footer>
        )}
      </div>
      {aside && <aside className="relative hidden overflow-hidden border-l bg-card lg:block">{aside}</aside>}
      <Toaster {...toasterProps(dark)} />
    </div>
  )
}
