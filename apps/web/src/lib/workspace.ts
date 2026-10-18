// The workspace's address (aftercall.app/{slug}) and email domains, shared by onboarding and
// Settings → Workspace. The backend checks all of it again: these are for instant feedback.
import { useEffect, useState } from 'react'
import { checkSlug, type ApiError, type SlugCheck } from '../api'

export { WORKSPACE_HOST as HOST } from '../config'

/** "Sunrise Clinic" → "sunrise-clinic". */
export const slugify = (name: string) =>
  name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')

export const slugProblem = (slug: string) =>
  !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) || slug.includes('--')
    ? 'Use 3 to 40 lowercase letters, numbers and single dashes.'
    : null

/** Email providers anyone can sign up with. A workspace can't let people join by these. */
const PUBLIC = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com'])
export const domainOf = (email?: string) => email?.split('@')[1]?.toLowerCase()
export const isCompanyDomain = (d?: string) => !!d && !PUBLIC.has(d)

/** Whether an address is free, checked 350 ms after typing stops. `current` is the workspace's own. */
export function useSlugCheck(slug: string, current?: string) {
  const [state, setState] = useState<{ slug: string; check?: SlugCheck; error?: string; checking: boolean }>({ slug, checking: false })
  useEffect(() => {
    const problem = slugProblem(slug)
    if (!slug || slug === current || problem) return setState({ slug, checking: false, error: slug && slug !== current ? problem ?? undefined : undefined })
    setState({ slug, checking: true })
    let live = true
    const id = setTimeout(() => {
      checkSlug(slug).then(
        (check) => live && setState({ slug, check, checking: false }),
        (e: ApiError) => live && setState({ slug, error: e.message, checking: false }),
      )
    }, 350)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [slug, current])
  const ok = slug === current || (state.slug === slug && !!state.check?.available)
  return { ...state, ok }
}
