// The API and integrations docs (/docs/api): their own site, with its own side nav, apart from the
// help centre. Groups and pages in reading order; a page's address is /docs/api/{slug}. Add a page
// here and it appears in the nav, the landing, the help centre's grid card and search.
import { BookOpenText, BracketsCurly, PaperPlaneTilt, PlugsConnected, Robot, Rocket, WebhooksLogo, type Icon } from '@phosphor-icons/react'
import { lazy, type ComponentType } from 'react'

export type ApiGroupId = 'start' | 'basics' | 'push' | 'results' | 'connectors' | 'ai' | 'reference'

export const API_GROUPS: { id: ApiGroupId; title: string; description: string; Icon: Icon }[] = [
  { id: 'start', Icon: Rocket, title: 'Get started', description: 'Keys, test mode, and your first pushed conversation.' },
  { id: 'basics', Icon: BracketsCurly, title: 'How the API works', description: 'Errors, pagination, retries, versions and limits.' },
  { id: 'push', Icon: PaperPlaneTilt, title: 'Send conversations', description: 'The transcript pusher: one at a time, in batches, or as files.' },
  { id: 'results', Icon: WebhooksLogo, title: 'Get results', description: 'Read answers, or have them sent to you with webhooks.' },
  { id: 'connectors', Icon: PlugsConnected, title: 'Connectors', description: 'Link a call platform, voice agent, help desk, CRM or warehouse.' },
  { id: 'ai', Icon: Robot, title: 'AI and agents', description: 'Let Claude, ChatGPT or Cursor ask aftercall questions.' },
  { id: 'reference', Icon: BookOpenText, title: 'API reference', description: 'Every endpoint, parameter and response.' },
]

export interface ApiPage {
  slug: string
  title: string
  /** Shorter name for the side nav, when the title is long. */
  nav?: string
  description: string
  group: ApiGroupId
  keywords?: string
  Body: ComponentType
  load: () => Promise<ComponentType>
}

const a = (m: () => Promise<Record<string, unknown>>, name: string) => {
  const load = async () => (await m())[name] as ComponentType
  return { Body: lazy(async () => ({ default: await load() })), load }
}
const guides = () => import('./guides')
const conn = () => import('./connectors')
const ref = () => import('./reference')

export const API_PAGES: ApiPage[] = [
  { slug: 'quickstart', title: 'Quickstart', description: 'Push a conversation and read its answers in five minutes.', group: 'start', keywords: 'tutorial first hello world curl', ...a(guides, 'Quickstart') },
  { slug: 'authentication', title: 'Authentication and API keys', nav: 'Authentication', description: 'Live and test keys, scopes, and keeping them safe.', group: 'start', keywords: 'bearer token secret key scopes rotate', ...a(guides, 'Authentication') },
  { slug: 'test-mode', title: 'Test mode', description: 'Build the integration without spending credits.', group: 'start', keywords: 'sandbox ac_test free', ...a(guides, 'TestMode') },

  { slug: 'errors', title: 'Errors', description: 'Status codes, error types, and what to do about each.', group: 'basics', keywords: '400 401 403 404 409 422 429 500 error type code', ...a(guides, 'Errors') },
  { slug: 'pagination', title: 'Pagination', description: 'Walk long lists with cursors.', group: 'basics', keywords: 'cursor starting_after has_more limit list', ...a(guides, 'Pagination') },
  { slug: 'idempotency', title: 'Idempotent requests', nav: 'Idempotency', description: 'Retry safely without doing anything twice.', group: 'basics', keywords: 'retry duplicate idempotency-key dedupe external_id', ...a(guides, 'Idempotency') },
  { slug: 'versioning', title: 'Versioning', description: 'Dated versions, and how upgrades work.', group: 'basics', keywords: 'aftercall-version upgrade breaking change', ...a(guides, 'Versioning') },
  { slug: 'rate-limits', title: 'Rate limits', description: 'How fast you can call, and handling 429s.', group: 'basics', keywords: '429 retry-after throttle limits backoff', ...a(guides, 'RateLimits') },

  { slug: 'push-conversations', title: 'Push conversations', description: 'Send each call or chat to aftercall as it ends.', group: 'push', keywords: 'transcript pusher ingest post conversations batch real time', ...a(guides, 'PushConversations') },
  { slug: 'conversation-format', title: 'Transcript formats', description: 'Any layout works. Here is what aftercall reads best.', group: 'push', keywords: 'transcript speaker turns metadata json text format', ...a(guides, 'ConversationFormat') },
  { slug: 'uploads', title: 'Large files and backfills', nav: 'Files and backfills', description: 'Send a big file straight to storage.', group: 'push', keywords: 'upload presigned csv jsonl backfill history import', ...a(guides, 'Uploads') },
  { slug: 'auto-run', title: 'Auto-run rules and caps', nav: 'Auto-run and caps', description: 'What runs on pushed conversations, and a daily limit.', group: 'push', keywords: 'auto run trackers daily cap spend credits waiting_for_credits', ...a(guides, 'AutoRun') },

  { slug: 'reading-results', title: 'Read results', description: 'Answers, confidence and review, one at a time or synced.', group: 'results', keywords: 'results answers confidence needs_review sync warehouse', ...a(guides, 'ReadingResults') },
  { slug: 'webhooks', title: 'Webhooks', description: 'Get told when results are ready.', group: 'results', keywords: 'webhook endpoint callback events delivery retries', ...a(guides, 'Webhooks') },
  { slug: 'webhook-events', title: 'Event types', description: 'Every event, and an example of each.', group: 'results', keywords: 'conversation.analyzed run.completed credits.low payload', ...a(guides, 'WebhookEvents') },
  { slug: 'verify-webhooks', title: 'Verify webhook signatures', nav: 'Verify signatures', description: 'Check each request really came from aftercall.', group: 'results', keywords: 'signature hmac sha256 aftercall-signature secret verify', ...a(guides, 'VerifyWebhooks') },

  { slug: 'connectors', title: 'Connectors', description: 'Every platform aftercall links to, and how connecting works.', group: 'connectors', keywords: 'integrations oauth connect sync list', ...a(conn, 'ConnectorsOverview') },
  { slug: 'voice-agents', title: 'Voice agents: Vapi, Retell, ElevenLabs, Bland, LiveKit', nav: 'Voice agents', description: 'Analyse every call your voice agent takes.', group: 'connectors', keywords: 'vapi retell elevenlabs bland livekit pipecat voice ai agent end of call report', ...a(conn, 'VoiceAgents') },
  { slug: 'twilio', title: 'Twilio', description: 'Calls and Conversations, through Voice Intelligence.', group: 'connectors', keywords: 'twilio voice intelligence conversations recording', ...a(conn, 'Twilio') },
  { slug: 'call-platforms', title: 'Phone systems and meetings', nav: 'Phones and meetings', description: 'Aircall, Dialpad, RingCentral, Zoom, Meet, Teams and contact centres.', group: 'connectors', keywords: 'aircall dialpad ringcentral zoom google meet microsoft teams genesys five9 talkdesk amazon connect gong', ...a(conn, 'CallPlatforms') },
  { slug: 'help-desks', title: 'Chats and help desks', description: 'Intercom, Zendesk, Freshdesk, Front and WhatsApp.', group: 'connectors', keywords: 'intercom zendesk freshdesk front whatsapp chat tickets', ...a(conn, 'HelpDesks') },
  { slug: 'crm', title: 'HubSpot and Salesforce', nav: 'CRM', description: 'Write answers onto calls and contacts.', group: 'connectors', keywords: 'hubspot salesforce crm properties fields', ...a(conn, 'Crm') },
  { slug: 'slack-and-teams', title: 'Slack and Microsoft Teams', nav: 'Slack and Teams', description: 'Alerts and a weekly digest in a channel.', group: 'connectors', keywords: 'slack teams alerts digest channel', ...a(conn, 'SlackTeams') },
  { slug: 'no-code', title: 'Zapier, Make and n8n', nav: 'Zapier, Make, n8n', description: 'Connect anything else without code.', group: 'connectors', keywords: 'zapier make n8n no code automation', ...a(conn, 'NoCode') },
  { slug: 'warehouses', title: 'Sheets and warehouses', description: 'Scheduled exports to Sheets, BigQuery, Snowflake and S3.', group: 'connectors', keywords: 'google sheets bigquery snowflake s3 gcs export bi', ...a(conn, 'Warehouses') },
  { slug: 'custom-platform', title: 'Any other platform', description: 'Build your own connector in an afternoon.', group: 'connectors', keywords: 'custom build own connector webhook relay', ...a(conn, 'CustomPlatform') },

  { slug: 'mcp', title: 'MCP server', description: 'Use aftercall from Claude, ChatGPT, Cursor and other AI tools.', group: 'ai', keywords: 'model context protocol claude chatgpt cursor ai assistant tools', ...a(guides, 'Mcp') },
  { slug: 'build-with-ai', title: 'Build with AI', description: 'llms.txt, copying pages for AI, and function definitions.', group: 'ai', keywords: 'llms.txt openai functions tools copy for ai', ...a(guides, 'BuildWithAi') },

  { slug: 'reference-conversations', title: 'Conversations', description: 'Create, get, list and delete conversations.', group: 'reference', keywords: 'post get delete conversations endpoint', ...a(ref, 'RefConversations') },
  { slug: 'reference-results', title: 'Results', description: 'List answers across conversations.', group: 'reference', keywords: 'get results endpoint', ...a(ref, 'RefResults') },
  { slug: 'reference-uploads', title: 'Uploads', description: 'Upload a file and follow it.', group: 'reference', keywords: 'post get uploads endpoint presigned', ...a(ref, 'RefUploads') },
  { slug: 'reference-runs', title: 'Runs', description: 'Run trackers over conversations you already sent.', group: 'reference', keywords: 'post get runs endpoint', ...a(ref, 'RefRuns') },
  { slug: 'reference-trackers', title: 'Trackers and signals', description: 'Read and manage the questions.', group: 'reference', keywords: 'trackers signals endpoint', ...a(ref, 'RefTrackers') },
  { slug: 'reference-projects', title: 'Projects', description: 'The projects keys can reach.', group: 'reference', keywords: 'projects endpoint', ...a(ref, 'RefProjects') },
  { slug: 'reference-insights', title: 'Insights', description: 'Totals for a signal over time.', group: 'reference', keywords: 'insights aggregate endpoint', ...a(ref, 'RefInsights') },
  { slug: 'reference-webhook-endpoints', title: 'Webhook endpoints', description: 'Add, change and remove endpoints.', group: 'reference', keywords: 'webhook endpoints endpoint', ...a(ref, 'RefWebhookEndpoints') },
  { slug: 'reference-events', title: 'Events', description: 'List and replay events.', group: 'reference', keywords: 'events replay endpoint', ...a(ref, 'RefEvents') },
  { slug: 'sdks', title: 'SDKs', description: 'Python and TypeScript libraries.', group: 'reference', keywords: 'python typescript node sdk library pip npm', ...a(ref, 'Sdks') },
  { slug: 'changelog', title: 'API changelog', nav: 'Changelog', description: 'Every change to the API, by version.', group: 'reference', keywords: 'changes versions release notes', ...a(ref, 'ApiChangelog') },
]

/** Reference pages are two columns wide, with no "On this page" rail. */
export const isWide = (p: ApiPage) => p.slug.startsWith('reference-')

export const apiPageBySlug = (slug?: string) => API_PAGES.find((x) => x.slug === slug)
export const apiPagesIn = (g: ApiGroupId) => API_PAGES.filter((x) => x.group === g)
export const apiGroupOf = (id: ApiGroupId) => API_GROUPS.find((g) => g.id === id)!
