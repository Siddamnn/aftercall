// The API the pages use. By default it talks to the backend (http-api.ts); with
// VITE_API_MOCK=true it uses the in-memory mock (mock-api.ts) so the UI runs on its own.
// '@api-impl' is picked in vite.config.ts at build time, so only one of the two is ever bundled.
// Types live in api-types.ts.
import sampleCalls from '../../../samples/calls_booking.json'
import sampleTrackers from '../../../samples/trackers_booking.json'
import type { SignalSpec } from './api-types'
import * as impl from '@api-impl'
import type * as http from './http-api'

export * from './api-types'

export const USING_MOCK = import.meta.env.VITE_API_MOCK === 'true'
const api: typeof http = impl

export const {
  listTrackers, saveTracker, deactivateTracker, saveSignal, deactivateSignal, deleteTracker, deleteSignal,
  importTrackers, getOverlap, checkOverlap,
  dryRun, createUpload, getUpload, listUploads, getResults, getCall, deleteUpload, deleteCall, downloadExport, getUsage,
  getDimensions, getInsights, listCalls, getSeries, getBreakdown, exportCalls,
  listDashboards, getDashboard, createDashboard, saveDashboard, deleteDashboard,
  getAccount, listProjects, createProject, updateProject, deleteProject, importTrackersFrom, listTrackersIn, setProject,
  alteriaConversations, alteriaTrackers, alteriaSignal, askAlteria, listThreads, getThread, updateThread, deleteThread,
  shareThread, copyThread, bulkThreads, getMe, updateMe, getTeam, invite, resendInvite, revokeInvite, setRole, removeMember,
  getBilling, getLedger, subscribe, cancelPlan, checkout, getInvoices, setAutoTopUp, getOverview,
  requestSignInLink, googleSignInUrl, verifySignIn, signOut, getInvite, acceptInvite, listJoinable, completeOnboarding,
  checkSlug, getWorkspace, updateWorkspace, onSignedOut, listNotifications, markNotificationsRead,
  getMembersUsage, getMyUsage, getAllowances, saveAllowances, quote, sendDocFeedback,
} = api

/** The shared sample file, for "Try the sample file" on the upload screen. */
export const sampleFile = () => new File([JSON.stringify(sampleCalls)], 'calls_booking.json', { type: 'application/json' })

/** Ready-made trackers for first-run setup and examples in the wizard: the shared sample set. */
export const TEMPLATES = (sampleTrackers as { name: string; description: string; signals: SignalSpec[] }[]).map((t) => ({
  name: t.name,
  description: t.description,
  signals: t.signals,
}))
