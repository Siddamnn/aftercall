// Upgrading to Pro, for workspaces on pay as you go: a card above the account block in the sidebar,
// and the same offer as a dialog once after each sign-in. People who can pay (owner, admins) start
// Pro; members are told who can. Viewers never see it. Nothing shows while billing is off.
import { Lightning, Sparkle, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { can } from './access'
import { useBilling } from './billing'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './components/ui/alert-dialog'
import { Button } from './components/ui/button'
import { ease } from './lib/motion'
import { cn } from './lib/utils'
import { useMe } from './people'
import { usd } from './plans'

const LOGIN_KEY = 'upgrade-after-login'
/** Called when a sign-in completes: the offer shows once in the app. */
export const markLogin = () => {
  try {
    sessionStorage.setItem(LOGIN_KEY, '1')
  } catch {
    // No popup this time; fine.
  }
}
const takeLogin = () => {
  try {
    const v = sessionStorage.getItem(LOGIN_KEY)
    sessionStorage.removeItem(LOGIN_KEY)
    return !!v
  } catch {
    return false
  }
}

const PERKS = [
  'Tokens included every month, at a lower rate above them',
  'Ask alteria about every conversation',
  'Share chats and export in bulk',
  'Unlimited teammates, 25 projects',
]

/** Whether to offer Pro, and who's looking: someone who can pay, or someone who has to ask. */
function useOffer() {
  const b = useBilling().data
  const me = useMe().data
  const show = !!b?.enabled && b.plan === 'payg' && can(me, 'billing.view')
  const pro = b?.plans.find((p) => p.id === 'pro')
  return { show, canBuy: can(me, 'billing.manage'), fee: pro?.monthly_fee ?? null, promotion: b?.promotion?.applies_to.includes('pro') ? b.promotion : null }
}

/** The sidebar card. Collapsed sidebar: a single icon that opens the dialog. */
export function UpgradeCard({ rail }: { rail?: boolean }) {
  const offer = useOffer()
  const [open, setOpen] = useState(false)
  if (!offer.show) return null
  return (
    <>
      {rail ? (
        <button onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary transition-transform duration-150 active:scale-[0.95]" aria-label="Upgrade to Pro">
          <Sparkle size={17} weight="fill" aria-hidden />
        </button>
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}
          className="relative overflow-hidden rounded-xl border border-primary/25 bg-primary-soft p-3" aria-labelledby="up-h"
        >
          <div aria-hidden className="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-primary/15 blur-2xl" />
          <h2 id="up-h" className="flex items-center gap-1.5 text-sm font-semibold text-primary"><Sparkle size={14} weight="fill" aria-hidden /> Get more with Pro</h2>
          <p className="mt-0.5 text-xs text-ink-2">
            {offer.promotion ? offer.promotion.label : offer.fee != null ? `Included tokens, alteria and bulk exports, for ${usd(offer.fee)} a month.` : 'Included tokens, alteria and bulk exports.'}
          </p>
          <Button size="sm" className="mt-2.5 w-full" onClick={() => setOpen(true)}>{offer.canBuy ? 'Upgrade' : 'See Pro'}</Button>
        </motion.section>
      )}
      <UpgradeDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** Opens once after each sign-in, for pay-as-you-go workspaces. */
export function UpgradeAfterLogin() {
  const offer = useOffer()
  const [pending] = useState(takeLogin)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!pending || !offer.show) return
    const id = setTimeout(() => setOpen(true), 900) // after the app has settled, not over the first paint
    return () => clearTimeout(id)
  }, [pending, offer.show])
  return <UpgradeDialog open={open} onOpenChange={setOpen} />
}

export function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const offer = useOffer()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="overflow-hidden p-0 sm:max-w-md">
        <div className="relative bg-primary px-6 pt-6 pb-5 text-primary-foreground">
          <button onClick={() => onOpenChange(false)} className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
          <span className="grid size-10 place-items-center rounded-xl bg-white/15"><Lightning size={20} weight="fill" aria-hidden /></span>
          <AlertDialogHeader className="mt-3 text-left">
            <AlertDialogTitle className="text-xl font-semibold tracking-tight text-primary-foreground">Your team, on Pro</AlertDialogTitle>
            <AlertDialogDescription className="text-primary-foreground/85">
              {offer.fee != null ? <>{usd(offer.fee)} a month, billed to your card. Cancel any time.</> : 'A monthly subscription. Cancel any time.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <div className="px-6 pt-4 pb-6">
          <AnimatePresence>
            {offer.promotion && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-3 rounded-lg bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
                {offer.promotion.label}
              </motion.p>
            )}
          </AnimatePresence>
          <ul className="space-y-2">
            {PERKS.map((p, i) => (
              <motion.li key={p} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease, delay: 0.05 * i }} className="flex items-start gap-2 text-sm">
                <Sparkle size={14} weight="fill" className="mt-0.5 shrink-0 text-primary" aria-hidden /> {p}
              </motion.li>
            ))}
          </ul>
          {!offer.canBuy && <p className="mt-4 text-xs text-muted-foreground">The workspace’s owner or an admin can start Pro.</p>}
          <AlertDialogFooter className={cn('mt-6 gap-2')}>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Not now</Button>
            <Button variant="outline" asChild onClick={() => onOpenChange(false)}><Link to="/pricing">Compare plans</Link></Button>
            {offer.canBuy && <Button asChild onClick={() => onOpenChange(false)}><Link to="/settings/credits"><Lightning weight="fill" aria-hidden /> Start Pro</Link></Button>}
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
