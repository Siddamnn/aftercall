// The docs: sections (the grid on /docs) and the articles in each, in reading order. An article's
// address is /docs/{slug}. Add an article here and it appears in the grid, the side nav and search.
import { BookOpen, CreditCard, Lifebuoy, Question, Rocket, Scales, UploadSimple, UsersThree, type Icon } from '@phosphor-icons/react'
import { lazy, type ComponentType } from 'react'

export type SectionId = 'start' | 'use' | 'import' | 'team' | 'billing' | 'faq' | 'support' | 'legal'

export const SECTIONS: { id: SectionId; title: string; description: string; Icon: Icon }[] = [
  { id: 'start', title: 'Getting started', description: 'How aftercall works, your first analysis, and what the words mean.', Icon: Rocket },
  { id: 'use', title: 'Using alteria', description: 'Trackers, analysing, results, Insights, dashboards and Ask alteria.', Icon: BookOpen },
  { id: 'import', title: 'Import trackers', description: 'Set up many trackers at once from a file, or with any AI assistant.', Icon: UploadSimple },
  { id: 'team', title: 'Team and account', description: 'Roles, invites, joining by domain, notifications and sign-in.', Icon: UsersThree },
  { id: 'billing', title: 'Plans and billing', description: 'Plans, credits, usage, allowances, currency and discounts.', Icon: CreditCard },
  { id: 'faq', title: 'FAQ', description: 'Short answers to what people ask most.', Icon: Question },
  { id: 'support', title: 'Support', description: 'Contact us, report a security issue.', Icon: Lifebuoy },
  { id: 'legal', title: 'Legal and security', description: 'Privacy, terms, data processing, cookies, security.', Icon: Scales },
]

export interface Article {
  slug: string
  title: string
  description: string
  section: SectionId
  /** Extra words for search. */
  keywords?: string
  updated: string
  /** A legal draft that hasn't had legal review: shows a notice. */
  draft?: boolean
  Body: ComponentType
  load: () => Promise<ComponentType>
}

/** An article's body: lazy for reading, and `load` for the search index (src/docs/search.ts). */
const a = (m: () => Promise<Record<string, unknown>>, name: string) => {
  const load = async () => (await m())[name] as ComponentType
  return { Body: lazy(async () => ({ default: await load() })), load }
}
const art = () => import('./articles')
const legal = () => import('./legal')
const guide = () => import('../pages/Guide')
const U = '2026-09-27'

export const ARTICLES: Article[] = [
  { slug: 'how-aftercall-works', title: 'How aftercall works', description: 'Trackers, analysis, results and insights, in four steps.', section: 'start', keywords: 'overview introduction', updated: U, ...a(art, 'HowItWorks') },
  { slug: 'first-analysis', title: 'Your first analysis', description: 'From a file of transcripts to results in five minutes.', section: 'start', keywords: 'tutorial quickstart sample', updated: U, ...a(art, 'FirstAnalysis') },
  { slug: 'glossary', title: 'Glossary', description: 'What tracker, signal, confidence, credits and the rest mean.', section: 'start', keywords: 'terms definitions meaning', updated: U, ...a(art, 'Glossary') },

  { slug: 'trackers-and-signals', title: 'Trackers and signals', description: 'Write questions that give confident answers.', section: 'use', keywords: 'yes no pick one score conditional overlap', updated: U, ...a(art, 'TrackersAndSignals') },
  { slug: 'analysing-conversations', title: 'Analysing conversations', description: 'File formats, the estimate, and the size limit.', section: 'use', keywords: 'upload csv json jsonl vtt srt text transcript format', updated: U, ...a(art, 'AnalysingConversations') },
  { slug: 'results-and-review', title: 'Results and review', description: 'Answers, confidence, and what needs a person.', section: 'use', keywords: 'confidence review', updated: U, ...a(art, 'ResultsAndReview') },
  { slug: 'insights', title: 'Insights', description: 'Every signal across every conversation.', section: 'use', keywords: 'filters compare trend', updated: U, ...a(art, 'InsightsDoc') },
  { slug: 'dashboards', title: 'Dashboards', description: 'Pages of charts for your team.', section: 'use', keywords: 'charts report', updated: U, ...a(art, 'DashboardsDoc') },
  { slug: 'ask-alteria', title: 'Ask alteria', description: 'Questions in plain words, answered from your conversations.', section: 'use', keywords: 'ai chat assistant', updated: U, ...a(art, 'AskAlteriaDoc') },
  { slug: 'projects', title: 'Projects', description: 'One use case each.', section: 'use', updated: U, ...a(art, 'ProjectsDoc') },
  { slug: 'exports', title: 'Exports', description: 'Every export and which plan includes it.', section: 'use', keywords: 'csv png pdf markdown zip download', updated: U, ...a(art, 'ExportsDoc') },

  { slug: 'import-trackers', title: 'Import trackers', description: 'A file of trackers, made by hand or with any AI assistant.', section: 'import', keywords: 'json template prompt', updated: U, ...a(guide, 'TrackersGuide') },

  { slug: 'workspace-and-roles', title: 'Workspace and roles', description: 'Owner, admin, member and viewer: who can do what.', section: 'team', keywords: 'permissions owner admin member viewer', updated: U, ...a(art, 'WorkspaceAndRoles') },
  { slug: 'invite-teammates', title: 'Invite teammates', description: 'By email, or by your company’s domain.', section: 'team', keywords: 'invite domain join', updated: U, ...a(art, 'InviteTeammates') },
  { slug: 'notifications', title: 'Notifications', description: 'The bell, and what’s emailed.', section: 'team', updated: U, ...a(art, 'NotificationsDoc') },
  { slug: 'sign-in-and-security', title: 'Sign-in and sessions', description: 'Google sign-in through Firebase.', section: 'team', keywords: 'login logout session expired', updated: U, ...a(art, 'SignInSecurity') },

  { slug: 'plans', title: 'Plans and pricing', description: 'Pay as you go and Pro, side by side.', section: 'billing', keywords: 'pro payg price', updated: U, ...a(art, 'PlansDoc') },
  { slug: 'credits', title: 'Credits and top-ups', description: 'How runs are held and charged.', section: 'billing', keywords: 'balance top up hold invoice auto', updated: U, ...a(art, 'CreditsDoc') },
  { slug: 'usage', title: 'Usage and allowances', description: 'What the workspace used, and who used it.', section: 'billing', keywords: 'tokens cost limit', updated: U, ...a(art, 'UsageDoc') },
  { slug: 'currency-and-discounts', title: 'Currency and discounts', description: 'Local prices, and codes at checkout.', section: 'billing', keywords: 'inr rupees euro coupon promo', updated: U, ...a(art, 'CurrencyDoc') },

  { slug: 'faq', title: 'Frequently asked questions', description: 'Getting started, pricing, account and data.', section: 'faq', updated: U, ...a(art, 'FaqDoc') },
  { slug: 'support', title: 'Contact support', description: 'Email us, and report security issues.', section: 'support', keywords: 'help contact email', updated: U, ...a(art, 'SupportDoc') },

  { slug: 'privacy', title: 'Privacy policy', description: 'What we collect, why, and your rights.', section: 'legal', keywords: 'gdpr dpdp ccpa personal data', updated: U, draft: true, ...a(legal, 'Privacy') },
  { slug: 'terms', title: 'Terms of service', description: 'The agreement for using aftercall.', section: 'legal', keywords: 'terms conditions agreement', updated: U, draft: true, ...a(legal, 'Terms') },
  { slug: 'dpa', title: 'Data processing agreement', description: 'How we process your workspace’s personal data.', section: 'legal', keywords: 'processor controller gdpr', updated: U, draft: true, ...a(legal, 'Dpa') },
  { slug: 'cookies', title: 'Cookie policy', description: 'Only what the app needs to work.', section: 'legal', updated: U, draft: true, ...a(legal, 'Cookies') },
  { slug: 'acceptable-use', title: 'Acceptable use policy', description: 'What aftercall can’t be used for.', section: 'legal', updated: U, draft: true, ...a(legal, 'AcceptableUse') },
  { slug: 'security', title: 'Security', description: 'How we protect your workspace, and responsible disclosure.', section: 'legal', keywords: 'vulnerability disclosure encryption', updated: U, draft: true, ...a(legal, 'Security') },
]

export const articleBySlug = (slug?: string) => ARTICLES.find((x) => x.slug === slug)
export const articlesIn = (s: SectionId) => ARTICLES.filter((x) => x.section === s)
export const sectionOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)!
