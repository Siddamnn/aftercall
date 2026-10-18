// Settings that differ per deployment, in one place. Public values only: anything here is in the
// page. The backend has the same host as APP_HOST (B50), so both change together.

/** The product's domain: workspace addresses (host/slug), links and the contact email. */
export const HOST = (import.meta.env.VITE_APP_HOST as string | undefined) || 'aftercall.app'
export const SITE = `https://${HOST}`
export const CONTACT = `hello@${HOST}`
export const SUPPORT = `support@${HOST}`
export const SECURITY = `security@${HOST}`
export const PRIVACY = `privacy@${HOST}`

/** The host shown in workspace addresses (host/slug): the configured domain, else wherever the app is served from. */
export const WORKSPACE_HOST = (import.meta.env.VITE_APP_HOST as string | undefined) || window.location.host

/** The tagline, on the signed-out screens and in the page title. */
export const MOTTO = 'You keep your conversations, we handle the rest.'

/** This build has no billing (no Stripe, no credits): the pricing, plan and top-up screens are
 *  hidden and `/billing` is never called. `VITE_BILLING=on` brings them back for a backend that
 *  charges. The mock can preview them with `?price=0.5` (or `?billing=on`). */
export const BILLING_ON =
  import.meta.env.VITE_BILLING === 'on' ||
  (import.meta.env.VITE_API_MOCK === 'true' && /[?&](price|billing=on)\b/.test(location.search))
