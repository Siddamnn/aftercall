// What each role can see and do (B54). The backend is the authority: it checks the role on every
// request (403), and leaves out of responses what the role may not see (a viewer's /billing has no
// balance). GET /me sends the person's `permissions`, and the page uses those. The map below is only
// the fallback until it does. Nothing here grants access: editing it, or the page, changes what's
// shown, never what the backend allows. Credits, plan and usage belong to the workspace.
import type { Me, Role } from './api'
import { useMe } from './people'

export type Area =
  | 'analyse' // upload and run conversations (spends credits)
  | 'trackers.edit' // create, change, import trackers
  | 'ask' // ask alteria (spends credits); everyone can read chats shared with them
  | 'projects.manage' // create, rename, delete projects
  | 'billing.view' // see the balance, plan and ledger (read only)
  | 'billing.manage' // add credits, change plan, auto top-up, invoices
  | 'usage.self' // your own usage and allowance, and the workspace's total
  | 'usage.members' // everyone's usage, and setting allowances
  | 'team.manage' // invite, remove, change roles
  | 'workspace.edit' // name, address, join by domain

const ALL: Area[] = ['analyse', 'trackers.edit', 'ask', 'projects.manage', 'billing.view', 'billing.manage', 'usage.self', 'usage.members', 'team.manage', 'workspace.edit']

export const ACCESS: Record<Role, Area[]> = {
  owner: ALL,
  admin: ALL,
  member: ['analyse', 'trackers.edit', 'ask', 'billing.view', 'usage.self'],
  // Viewers read Insights, dashboards, results and shared chats, and ask alteria within their
  // allowance (25% by default). They see no money and no usage pages.
  viewer: ['ask'],
}

/** From /me: the backend's `permissions` when it sends them, else the role's fallback list. Open
 *  before /me answers (and before the backend has people), so the app works as it did. */
export function can(who: Pick<Me, 'role' | 'permissions'> | Role | undefined, area: Area) {
  if (!who) return true
  if (typeof who === 'string') return ACCESS[who].includes(area)
  return who.permissions ? who.permissions.includes(area) : ACCESS[who.role].includes(area)
}

/** Whether the signed-in person may see or do this. */
export function useCan(area: Area) {
  return can(useMe().data, area)
}

/** Pages that need an area. Anything not listed is open to every role. */
export const ROUTE_NEEDS: [RegExp, Area][] = [
  [/^\/analyse/, 'analyse'],
  [/^\/trackers/, 'trackers.edit'],
  [/^\/guide/, 'trackers.edit'],
  [/^\/projects/, 'projects.manage'],
  [/^\/settings\/credits\/add/, 'billing.manage'],
  [/^\/settings\/credits/, 'billing.view'],
  [/^\/settings\/usage\/allowances/, 'usage.members'],
  [/^\/settings\/usage/, 'usage.self'],
]
export const areaFor = (path: string) => ROUTE_NEEDS.find(([re]) => re.test(path))?.[1]
