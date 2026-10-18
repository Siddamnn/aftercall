// Legal pages. DRAFTS: complete in structure, written for GDPR, UK GDPR, CCPA/CPRA and India's DPDP
// Act 2023, with [placeholders] for company facts. A lawyer must review them before launch; until
// then each shows a draft notice (registry.tsx: draft: true).
import { HOST, PRIVACY, SECURITY, SUPPORT } from '../config'
import { A, B, H2, Lead, List, P, Table } from './kit'

const ENTITY = '[aftercall legal entity name]'
const ADDRESS = '[registered address]'

export function Privacy() {
  return (
    <>
      <Lead>This policy explains what personal data aftercall collects, why, who it’s shared with, and your rights. It covers {HOST} and the aftercall app.</Lead>
      <H2>Who we are</H2>
      <P>aftercall is run by {ENTITY}, {ADDRESS} (“we”). For your account data we are the controller. For the conversations your workspace uploads, your organisation is the controller and we process them on its behalf (see the <A to="/docs/dpa">Data processing agreement</A>).</P>
      <H2>What we collect</H2>
      <Table head={['Data', 'Examples', 'Source']} rows={[
        ['Account', 'Name, email, profile photo, sign-in method, role', 'You, or your sign-in provider'],
        ['Workspace content', 'Transcripts, metadata you upload, trackers, results, dashboards, alteria chats', 'Your workspace'],
        ['Billing', 'Plan, credit balance, invoices, country; card details are held by the payment provider, not us', 'You, the payment provider'],
        ['Usage', 'Tokens used, runs, pages visited, errors', 'The app'],
        ['Device and log', 'IP address, browser, time zone, approximate country', 'Your browser'],
      ]} />
      <H2>How we use it</H2>
      <List items={[
        'To provide the service: analyse conversations, show results, run alteria, keep your workspace working.',
        'To bill you, prevent fraud and enforce limits.',
        'To secure the service: sign-in (Google, through Firebase Authentication), abuse and incident detection.',
        'To support you when you ask.',
        'To send service emails, and the notifications you choose.',
        'To improve aftercall, using aggregated usage. [State here whether workspace content is ever used to improve models. Default: it is not.]',
      ]} />
      <H2>Legal bases (GDPR and UK GDPR)</H2>
      <P>Contract (providing the service), legitimate interests (security, improving the product, B2B communication), legal obligation (tax and accounting records), and consent where we ask for it.</P>
      <H2>Who we share it with</H2>
      <P>Service providers that process data for us under contract (hosting, sign-in, the AI models that analyse conversations, payments, email), with the same protections as this policy; your workspace’s owners and admins; and authorities when the law requires it. The current list is available from <A to={`mailto:${PRIVACY}`}>{PRIVACY}</A>. We don’t sell personal data or share it for cross-context behavioural advertising.</P>
      <H2>International transfers</H2>
      <P>Data may be processed outside your country. Where required, we use Standard Contractual Clauses or other lawful transfer mechanisms. [Say where data is stored.]</P>
      <H2>How long we keep it</H2>
      <P>Account data for as long as the account exists. Workspace content until the workspace deletes it, or [30] days after the workspace is closed. Invoices for as long as tax law requires. Logs for [90] days.</P>
      <H2>Security</H2>
      <P>Encryption in transit, access limited by role, sign-in handled by Google and Firebase Authentication, and more on our <A to="/docs/security">Security</A> page.</P>
      <H2>Your rights</H2>
      <P>Depending on where you live, you can ask to access, correct, delete or export your data, object to or restrict processing, and withdraw consent. California residents can also ask what we collect and opt out of sale or sharing (we don’t do either). Under India’s DPDP Act you can also nominate someone to act for you, and raise a grievance with our Grievance Officer, then the Data Protection Board of India.</P>
      <P>Write to <A to={`mailto:${PRIVACY}`}>{PRIVACY}</A>. For conversations your organisation uploaded, we’ll pass your request to it. We reply within one month, or as the law requires. You can complain to your data protection authority.</P>
      <H2>Grievance Officer and representatives</H2>
      <P>[Name], Grievance Officer, <A to={`mailto:${PRIVACY}`}>{PRIVACY}</A>. [EU and UK representative, if required.]</P>
      <H2>Children</H2>
      <P>aftercall is for businesses and isn’t meant for anyone under 18.</P>
      <H2>Changes</H2>
      <P>We’ll post changes here and update the date above. For significant changes we’ll email workspace owners first.</P>
    </>
  )
}

export function Terms() {
  return (
    <>
      <Lead>These terms are the agreement between {ENTITY} and the organisation using aftercall (“you”). By creating a workspace or using the service you accept them on your organisation’s behalf.</Lead>
      <H2>The service</H2>
      <P>aftercall analyses conversations you upload with the trackers you define, and provides insights, dashboards and a built-in AI assistant (Ask alteria). We may improve and change features; we won’t remove core functionality you pay for without notice.</P>
      <H2>Accounts and workspaces</H2>
      <List items={[
        'You’re responsible for who you invite and the roles you give them, and for keeping sign-in methods secure.',
        'The workspace owner can manage people, billing and data for the workspace.',
        'You must give accurate information and be able to bind your organisation.',
      ]} />
      <H2>Plans, credits and payment</H2>
      <List items={[
        'Usage is paid from prepaid credits, per token, at the prices shown when you use it. Pro is a monthly subscription, billed to your card, that includes a token allowance each month.',
        'Prices are shown in your local currency and may differ by region. Taxes are added where required.',
        'Credits don’t expire while the workspace is active. [State refund terms, e.g. unused credits are refunded only where the law requires.]',
        'Pro renews monthly until cancelled, and stays active until the end of the paid month.',
        'Discounts apply only as their terms say, and can’t be combined unless stated.',
      ]} />
      <H2>Your data</H2>
      <P>You own the content you upload and the results produced from it. You give us permission to process it only to provide and secure the service, as described in the <A to="/docs/dpa">Data processing agreement</A>. You confirm you have the right to upload it, including any notice or consent the people in the conversations need.</P>
      <H2>AI output</H2>
      <P>Answers come from AI models and include a confidence score. They can be wrong. Review answers before relying on them for decisions about people, and don’t use aftercall as the sole basis for legal, medical, employment or credit decisions.</P>
      <H2>Acceptable use</H2>
      <P>You’ll follow our <A to="/docs/acceptable-use">Acceptable use policy</A>. We may suspend access that breaks it or puts others at risk, telling you first where we can.</P>
      <H2>Confidentiality and security</H2>
      <P>Each side keeps the other’s confidential information confidential. We protect your data as described on the <A to="/docs/security">Security</A> page.</P>
      <H2>Warranties and liability</H2>
      <P>[To be completed by counsel: availability commitments, warranty disclaimers, the cap on liability (commonly the fees paid in the prior 12 months), exclusions, and indemnities.]</P>
      <H2>Ending the agreement</H2>
      <P>You can close your workspace at any time. We may end these terms if you materially breach them and don’t fix it within 30 days. After closing, you can export your data for [30] days, then it’s deleted.</P>
      <H2>General</H2>
      <P>Governing law and courts: [jurisdiction]. We’ll notify workspace owners of material changes to these terms in advance. Questions: <A to={`mailto:${SUPPORT}`}>{SUPPORT}</A>.</P>
    </>
  )
}

export function Dpa() {
  return (
    <>
      <Lead>A summary of how we process the conversations and other personal data your workspace uploads. The signed agreement is available on request.</Lead>
      <H2>Roles</H2>
      <P>You (the customer) are the controller of workspace content. We are your processor, and act only on your documented instructions: using aftercall is those instructions.</P>
      <H2>What we process</H2>
      <Table head={['', '']} rows={[
        ['Subjects', 'People in your conversations (your customers, your staff), and your users'],
        ['Data', 'Transcripts, names or identifiers they mention, metadata you upload, results'],
        ['Purpose', 'Providing aftercall: analysis, insights, the AI assistant, support'],
        ['Duration', 'While the workspace exists, plus the deletion period in the Terms'],
      ]} />
      <H2>Our commitments</H2>
      <List items={[
        'Only people who need access have it, under confidentiality.',
        'Security measures appropriate to the risk (see Security).',
        'Subprocessors only under written terms with the same protections, with notice to workspace owners before adding one. The list is available on request.',
        'Help with requests from people exercising their rights, and with impact assessments.',
        'Notice of a personal data breach without undue delay.',
        'Deletion or return of data when the service ends.',
        'Standard Contractual Clauses for transfers out of the EEA and UK.',
        'Information needed to show compliance, and reasonable audits.',
      ]} />
      <P>To request the signed DPA, email <A to={`mailto:${PRIVACY}`}>{PRIVACY}</A>.</P>
    </>
  )
}

export function Cookies() {
  return (
    <>
      <Lead>aftercall uses only what it needs to work. No advertising cookies, and no third-party trackers.</Lead>
      <Table head={['Name', 'Kind', 'Why', 'How long']} rows={[
        ['Firebase sign-in (Google)', 'Browser storage', 'Keeps you signed in', 'Until you sign out'],
        ['theme', 'Browser storage', 'Remembers light or dark', 'Until cleared'],
        ['sidebar, project, resume-path', 'Browser storage', 'Remembers your layout, open project and last page', 'Until cleared'],
      ]} />
      <P>Essential storage doesn’t need consent. If we add analytics, we’ll ask first where the law requires, and list them here.</P>
    </>
  )
}

export function AcceptableUse() {
  return (
    <>
      <Lead>Rules that keep aftercall safe and fair for everyone.</Lead>
      <P>Don’t use aftercall to:</P>
      <List items={[
        'Upload conversations you have no right to process, or record people without the notice or consent the law requires.',
        'Profile or make decisions about people in ways that are unlawful or discriminatory.',
        'Upload malware, or content that is illegal to hold.',
        'Break, probe or overload the service, or get around limits, plans, roles or security.',
        'Access another workspace’s data, or share accounts to avoid seat limits.',
        'Resell aftercall, or use it to build a competing product, without our written agreement.',
      ]} />
      <P>Report misuse to <A to={`mailto:${SECURITY}`}>{SECURITY}</A>.</P>
    </>
  )
}

export function Security() {
  return (
    <>
      <Lead>How we protect your workspace. Found a vulnerability? Email <A to={`mailto:${SECURITY}`}>{SECURITY}</A>.</Lead>
      <H2>Access</H2>
      <List items={[
        <><B>Sign-in</B> with Google, through Firebase Authentication; no passwords stored by us.</>,
        <><B>Short-lived tokens.</B> Your browser sends a Google-signed token that Firebase renews on its own and revokes when you sign out.</>,
        <><B>Roles</B> decide what each person sees and does. The server checks every request, not only the page.</>,
        <><B>Staff access</B> to customer data only to give support you asked for, and it’s logged.</>,
      ]} />
      <H2>Data</H2>
      <List items={[
        'Encrypted in transit (TLS). [Encrypted at rest: confirm before launch.]',
        'Each workspace’s data is kept apart at the database level.',
        'Payment details are held by the payment provider, never by us.',
        '[Backups: frequency and retention.]',
      ]} />
      <H2>Responsible disclosure</H2>
      <P>Send details and steps to reproduce to {SECURITY}. Please don’t access other customers’ data, degrade the service, or share the issue before it’s fixed. We’ll confirm receipt, keep you updated, and credit you if you’d like.</P>
    </>
  )
}
