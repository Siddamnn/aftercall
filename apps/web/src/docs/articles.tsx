// Docs articles about using aftercall. Written for customers: what to do, and what things mean.
// Legal pages are in legal.tsx; the list and sections are in registry.tsx.
import { CONTACT, SECURITY, SUPPORT } from '../config'
import { A, B, Code, Faq, H2, Lead, List, Note, P, Steps, Table, Terms } from './kit'

// ── Getting started ────────────────────────────────────────────────────────────

export function HowItWorks() {
  return (
    <>
      <Lead>aftercall asks every conversation the same questions, the same way, and gives each answer a confidence score. You decide the questions once; aftercall answers them for every call and chat you upload.</Lead>
      <H2>The four steps</H2>
      <Steps items={[
        { title: 'Set up trackers', body: <>A <B>tracker</B> is a group of questions about one topic, like “Booking” or “Compliance”. Each question is a <B>signal</B>: “Did the agent confirm the booking?”, “Why did the customer call?”. Start from a template, write your own, or let alteria draft them. <A to="/docs/trackers-and-signals">Trackers and signals</A></> },
        { title: 'Analyse conversations', body: <>Upload a file of transcripts in any layout. Before anything runs, aftercall shows how many conversations it found, the tokens they’ll use and the cost. <A to="/docs/analysing-conversations">Analysing conversations</A></> },
        { title: 'Review the results', body: <>Every conversation gets an answer to every signal, with a confidence score. Answers below your review line are marked for a person to check. <A to="/docs/results-and-review">Results and review</A></> },
        { title: 'Understand the patterns', body: <>Insights shows each signal across all your conversations, how it changed, and by channel or agent version. Build dashboards, or ask alteria in plain words. <A to="/docs/insights">Insights</A></> },
      ]} />
      <H2>How your account is organised</H2>
      <List items={[
        <><B>Workspace:</B> your company or team. It holds the people, the plan, the credits and every project.</>,
        <><B>Project:</B> one use case, like “Front desk calls” or “Voice agent”. Each has its own trackers, conversations, insights and dashboards.</>,
        <><B>People:</B> owners, admins, members and viewers. <A to="/docs/workspace-and-roles">Workspace and roles</A></>,
      ]} />
      <Note kind="tip">New here? <A to="/docs/first-analysis">Your first analysis</A> takes about five minutes with the sample file.</Note>
    </>
  )
}

export function FirstAnalysis() {
  return (
    <>
      <Lead>Run your first analysis in about five minutes. You can use the sample file, or your own transcripts.</Lead>
      <Steps items={[
        { title: 'Create a tracker', body: <>Open <B>Trackers</B> and choose a template, or <B>New tracker</B>. Keep it to 3 to 6 signals to start: you can add more any time.</> },
        { title: 'Open Analyse calls', body: <>Drop a file, or choose <B>Try the sample file</B>. aftercall reads it and shows what it found: the number of conversations, any it skipped and why, and one example.</> },
        { title: 'Choose trackers and check the cost', body: <>Pick which trackers to run. The estimate updates as you choose: tokens, the number of requests, and the cost. Nothing is charged yet.</> },
        { title: 'Run', body: <>aftercall holds the estimate from your credits, analyses every conversation, and charges only what was used. You can leave the page; you’ll get a notification when it’s done.</> },
        { title: 'Read the results', body: <>Open <B>Results</B> for each conversation’s answers, or <B>Insights</B> for the totals. Anything marked <B>needs review</B> is worth a look first.</> },
      ]} />
      <Note>Calls over the size limit aren’t run and cost nothing. They’re listed in the results so you know which ones.</Note>
    </>
  )
}

export function Glossary() {
  return (
    <>
      <Lead>What the words in aftercall mean.</Lead>
      <H2>Your account</H2>
      <Terms items={[
        { term: 'Workspace', means: 'Your company or team. It holds people, the plan, credits and projects. Its address is its name in a link, like aftercall.app/sunrise-clinic.' },
        { term: 'Project', means: 'One use case inside a workspace, with its own trackers, conversations, insights and dashboards.' },
        { term: 'Viewer', means: 'A free seat that can read Insights, dashboards, results and shared chats, and ask alteria within an allowance.' },
      ]} />
      <H2>Trackers and signals</H2>
      <Terms items={[
        { term: 'Tracker', means: 'A group of signals about one topic, such as Booking or Compliance.', see: { to: '/docs/trackers-and-signals', label: 'More' } },
        { term: 'Signal', means: 'One question asked of every conversation. It has a type, instructions, and the answers it can give.' },
        { term: 'Yes or no', means: 'A signal type: did something happen? The answer is yes or no.' },
        { term: 'Pick one', means: 'A signal type: which of your options fits best, such as the reason for calling. Always has an “Other” option.' },
        { term: 'Score', means: 'A signal type: how much, on a scale you define, such as frustration from 0 to 5.' },
        { term: 'Conditional tracker', means: 'A tracker that only runs when another answer says so, such as asking about the decline reason only when the customer declined. It saves tokens.' },
      ]} />
      <H2>Conversations and results</H2>
      <Terms items={[
        { term: 'Conversation', means: 'One call, chat or message thread: its transcript, plus anything that helps you slice results, like the channel, agent version or team.' },
        { term: 'Run', means: 'Analysing one upload with the trackers you chose.' },
        { term: 'Confidence', means: 'How sure aftercall is of an answer, from 0 to 100%. It’s measured, not guessed: low confidence usually means the conversation didn’t say clearly.' },
        { term: 'Review line', means: 'The confidence below which an answer is marked for a person to check.' },
        { term: 'Needs review', means: 'An answer below the review line. Check these first; your corrections improve accuracy over time.' },
      ]} />
      <H2>Money</H2>
      <Terms items={[
        { term: 'Token', means: 'The unit of text the model reads. A minute of conversation is roughly 150 to 250 tokens. You pay per token.' },
        { term: 'Estimate', means: 'The tokens and cost of a run, shown before it starts.' },
        { term: 'Credits', means: 'Prepaid money in the workspace. Runs and alteria are charged from it.', see: { to: '/docs/credits', label: 'More' } },
        { term: 'Hold', means: 'When a run starts, its estimate is set aside from your credits. When it finishes, you’re charged what it used and the rest is returned.' },
        { term: 'Allowance', means: 'How much of the workspace’s monthly budget one person can use: members 50% and viewers 25% by default. Owners and admins change it per role or per person.' },
      ]} />
      <H2>Insights and alteria</H2>
      <Terms items={[
        { term: 'Insights', means: 'Every signal across all conversations in a project, with changes and breakdowns.' },
        { term: 'Dashboard', means: 'A page of charts you build and share.' },
        { term: 'Ask alteria', means: 'The built-in AI assistant. It drafts trackers and signals, and answers questions about your conversations with charts and the conversations behind them.' },
      ]} />
    </>
  )
}

// ── Using aftercall ────────────────────────────────────────────────────────────

export function TrackersAndSignals() {
  return (
    <>
      <Lead>Trackers hold the questions aftercall asks every conversation. Good signals are specific, answerable from the transcript, and have clear options.</Lead>
      <H2>Create a tracker</H2>
      <List ordered items={[
        <>Open <B>Trackers</B> and choose <B>New tracker</B>, or start from a template.</>,
        <>Name it after the topic, like “Booking outcome”.</>,
        <>Add signals one at a time. The editor walks you through the type, the question and the options, and shows the tokens each one adds.</>,
      ]} />
      <H2>Write signals that work</H2>
      <Table head={['Do', 'Instead of']} rows={[
        ['“Did the agent offer another slot before the call ended?”', '“Was the agent helpful?”'],
        ['Options that don’t overlap: Price, Timing, Went elsewhere, Not stated', 'Options that do: Price, Too expensive, Cost'],
        ['A score with each step described (0: calm … 5: angry)', 'A score with no scale'],
      ]} />
      <Note kind="tip">Always include a way to say “not mentioned”. Forcing an answer the conversation doesn’t give lowers confidence everywhere.</Note>
      <H2>Conditional trackers</H2>
      <P>Set a tracker to run only when another answer matches, such as the <Code>Decline reason</Code> tracker only when <Code>Outcome</Code> is Declined. Conversations it skips cost nothing for it.</P>
      <H2>Overlap checks</H2>
      <P>aftercall warns when two signals ask much the same thing, so you don’t pay twice for one answer.</P>
      <H2>Import and share trackers</H2>
      <P>Move trackers between projects, or import many at once from a file. <A to="/docs/import-trackers">Import trackers</A></P>
    </>
  )
}

export function AnalysingConversations() {
  return (
    <>
      <Lead>Upload transcripts as you have them. aftercall reads the layout, shows what it found, and asks before spending anything.</Lead>
      <H2>File formats</H2>
      <Table head={['Format', 'What aftercall reads']} rows={[
        ['CSV', 'One conversation per row, with the transcript in any column. Other columns become filters.'],
        ['JSON', 'A list of conversations, or an object holding one. Transcripts as text, or as turns with a speaker.'],
        ['JSONL', 'One conversation per line.'],
        ['Plain text', <>Lines like <Code>Agent: Hello…</Code>. Several conversations separated by a blank line or <Code>---</Code>.</>],
        ['VTT and SRT', 'Subtitle files from call recorders and meeting tools, with timings.'],
      ]} />
      <P>Files can be up to 50 MB. Fields that help later: <Code>external_id</Code> (your ID, so re-uploads are skipped), <Code>channel</Code>, <Code>agent_version</Code>, <Code>started_at</Code>, and anything else, which becomes a filter in Insights.</P>
      <H2>Before it runs</H2>
      <P>You see the conversations found, any skipped and why, the tokens, the number of requests and the cost. Changing the trackers re-prices it. Nothing is charged until you choose <B>Run</B>.</P>
      <H2>Size limit</H2>
      <P>Very long conversations over the token limit aren’t analysed and cost nothing. They stay in the results, marked, so you know.</P>
      <Note>Only owners, admins and members can analyse. Viewers can read the results.</Note>
    </>
  )
}

export function ResultsAndReview() {
  return (
    <>
      <Lead>Results show every conversation and every answer, with how confident aftercall is.</Lead>
      <H2>Reading results</H2>
      <List items={[
        <>Each upload has a table: one row per conversation, one column per signal.</>,
        <>Open a conversation to see its transcript beside its answers.</>,
        <>The confidence bar shows how sure each answer is. Amber means it needs review.</>,
      ]} />
      <H2>Review</H2>
      <P>Filter to <B>needs review</B> and check those first. Low confidence usually means the conversation didn’t say clearly, or the signal’s options don’t fit.</P>
      <H2>Export</H2>
      <P>Download an upload’s results as CSV, with every answer and confidence. <A to="/docs/exports">All exports</A></P>
    </>
  )
}

export function InsightsDoc() {
  return (
    <>
      <Lead>Insights shows each signal across every conversation in a project: the split of answers, how it changed, and what drives it.</Lead>
      <H2>The view</H2>
      <List items={[
        <><B>Range:</B> 7, 30 or 90 days, or all time. Changes are compared with the period before.</>,
        <><B>Filters:</B> channel, agent version, and any field from your files.</>,
        <><B>Cards:</B> one per signal, with the share of each answer and how many need review.</>,
      ]} />
      <H2>Go deeper</H2>
      <P>Select an answer to see the conversations behind it. Pin a card to a dashboard. Copy the link to share this exact view.</P>
      <Note kind="tip">A large “Other” or “Not stated” share usually means a signal is missing an option.</Note>
    </>
  )
}

export function DashboardsDoc() {
  return (
    <>
      <Lead>Dashboards are pages of charts you arrange, for a team review or a weekly report.</Lead>
      <List items={[
        <>Create one from Insights (pin a card) or from <B>Dashboards → New</B>.</>,
        <>Charts: number, bar, trend, mix over time, compare, heatmap.</>,
        <>Drag to reorder, and resize each chart.</>,
        <>Export a chart as CSV or PNG, or the dashboard as PNG or PDF. A whole dashboard as one CSV is part of Pro.</>,
      ]} />
    </>
  )
}

export function AskAlteriaDoc() {
  return (
    <>
      <Lead>Ask alteria questions in plain words, like “Why are reschedules up this week?”. It answers from your conversations, with a chart and the conversations behind it.</Lead>
      <H2>Good questions</H2>
      <List items={['“Which reason for declining grew most after v13?”', '“Compare frustration on chats and calls.”', '“Show me calls where the agent misstated the policy.”']} />
      <H2>Chats</H2>
      <P>Chats are saved per project and private to you. Rename, pin, export as Markdown or PDF, or share one with the team (Pro): they read it and carry on in their own copy.</P>
      <H2>Plans</H2>
      <P>Ask alteria is part of Pro. On pay as you go, a workspace has 3 questions to try it.</P>
    </>
  )
}

export function ProjectsDoc() {
  return (
    <>
      <Lead>A project is one use case: its own trackers, conversations, insights and dashboards. Switch between them at the top of the sidebar.</Lead>
      <List items={[
        'Create one for each kind of conversation you analyse differently, like front desk calls and a voice agent.',
        'Copy trackers from another project when you create one.',
        'Pay as you go includes 5 projects; Pro includes 25.',
        'Owners and admins create, rename and delete projects.',
      ]} />
    </>
  )
}

export function ExportsDoc() {
  return (
    <>
      <Lead>Every export, where to find it, and which plan includes it.</Lead>
      <Table head={['Export', 'Where', 'Plan']} rows={[
        ['One run’s results, CSV', 'Results', 'Both'],
        ['Insights summary, CSV', 'Insights → Export', 'Both'],
        ['Insights as PNG or PDF', 'Insights → Export', 'Both'],
        ['A chart as CSV or PNG', 'The chart’s menu', 'Both'],
        ['A dashboard as PNG or PDF', 'Dashboard → Export', 'Both'],
        ['A chat as Markdown or PDF', 'The chat’s menu', 'Both'],
        ['Every conversation in a view, CSV', 'Insights → Export', 'Pro'],
        ['A whole dashboard, CSV', 'Dashboard → Export', 'Pro'],
        ['Many chats in one .zip', 'Ask alteria → Select', 'Pro'],
      ]} />
    </>
  )
}

// ── Team and account ───────────────────────────────────────────────────────────

export function WorkspaceAndRoles() {
  return (
    <>
      <Lead>Everyone in a workspace shares its projects, plan and credits. What each person can do depends on their role.</Lead>
      <Table head={['', 'Owner', 'Admin', 'Member', 'Viewer']} rows={[
        ['Read Insights, dashboards, results, shared chats', '✓', '✓', '✓', '✓'],
        ['Ask alteria (within their allowance)', '✓', '✓', '✓', '✓'],
        ['Analyse, build trackers', '✓', '✓', '✓', ''],
        ['See credits and their own usage', '✓', '✓', '✓', ''],
        ['Add credits, change the plan, see invoices', '✓', '✓', '', ''],
        ['See everyone’s usage, set allowances', '✓', '✓', '', ''],
        ['Invite people, change roles, manage projects', '✓', '✓', '', ''],
        ['Rename the workspace, change its address', '✓', '✓', '', ''],
        ['Delete or transfer the workspace', '✓', '', '', ''],
      ]} />
      <P>Viewer seats are free on every plan. Viewers can ask alteria, which uses the workspace’s credits within their allowance (25% of the monthly budget by default); on pay as you go, alteria has 3 questions for the whole workspace to try. Pay as you go includes 3 people who can analyse; Pro has no limit, with no fee per person.</P>
      <H2>The workspace’s name and address</H2>
      <P>Owners and admins change them in <B>Settings → Workspace</B>. Your own name is changed in <B>Settings → Profile</B>.</P>
    </>
  )
}

export function InviteTeammates() {
  return (
    <>
      <Lead>Add people by invite, or let everyone at your company join on their own.</Lead>
      <H2>Invite with a link</H2>
      <List ordered items={[<>Open <B>Settings → Team</B>.</>, 'Enter their email and choose a role.', 'Copy the invite link and share it with them (nobody is emailed). Invites last 7 days; you can get a new link or revoke an invite.']} />
      <H2>Join by email domain</H2>
      <P>In <B>Settings → Workspace</B>, add your company’s domain (such as <Code>sunriseclinic.com</Code>) and turn on joining. Anyone who signs in with a verified email at that domain finds the workspace and joins as a member or viewer, your choice. Public email providers like Gmail can’t be used.</P>
    </>
  )
}

export function NotificationsDoc() {
  return (
    <>
      <Lead>The bell at the top of the sidebar collects what happened while you were away.</Lead>
      <List items={['A run finished, or some conversations couldn’t be read', 'A teammate shared a chat', 'Credits are running low, or were added', 'Someone joined the workspace', 'An alert on a signal']} />
      <P>Choose what’s also emailed in <B>Settings → Profile</B>. People who don’t see billing don’t get billing notifications.</P>
    </>
  )
}

export function SignInSecurity() {
  return (
    <>
      <Lead>Sign in with Google, through Firebase Authentication. There’s no password to leak or forget.</Lead>
      <H2>Staying signed in</H2>
      <P>Your browser holds a short-lived Google-signed token that Firebase renews by itself, so you stay signed in until you sign out or Google ends the session.</P>
      <H2>Signing out</H2>
      <P>Open the account menu at the bottom of the sidebar and choose <B>Sign out</B>.</P>
      <P>Found a security issue? <A to="/docs/support">Report it</A>.</P>
    </>
  )
}

// ── Plans and billing ──────────────────────────────────────────────────────────

export function PlansDoc() {
  return (
    <>
      <Lead>Two plans, both with prepaid credits. You pay for the tokens your conversations use, and nothing per seat.</Lead>
      <Table head={['', 'Pay as you go', 'Pro']} rows={[
        ['Fee', 'None', 'Monthly subscription, billed to your card'],
        ['Tokens', 'Standard rate', 'Included every month, then a lower rate'],
        ['Ask alteria', '3 questions to try', '✓'],
        ['Share chats, bulk exports', '', '✓'],
        ['People who can analyse', '3', 'Unlimited'],
        ['Projects', '5', '25'],
      ]} />
      <P>Current prices, in your currency, are on the <A to="/pricing">pricing page</A>.</P>
    </>
  )
}

export function CreditsDoc() {
  return (
    <>
      <Lead>Credits are the workspace’s prepaid balance. Runs and alteria are charged from them, per token.</Lead>
      <H2>How a run is charged</H2>
      <Steps items={[
        { title: 'Estimate', body: 'Before a run, you see its tokens and cost.' },
        { title: 'Hold', body: 'When it starts, that estimate is set aside from your credits.' },
        { title: 'Charge', body: 'When it finishes, you’re charged what it actually used, and the rest is returned.' },
      ]} />
      <H2>Adding credits</H2>
      <P>Owners and admins add credits in <B>Settings → Plan and credits → Add credits</B>, and can turn on auto top-up. Every payment gets an invoice. Have a discount code? Enter it before paying.</P>
    </>
  )
}

export function UsageDoc() {
  return (
    <>
      <Lead>See what the workspace used, and who used it.</Lead>
      <List items={[
        <><B>Everyone who can analyse</B> sees the workspace’s total and their own usage in <B>Settings → Usage</B>.</>,
        <><B>Owners and admins</B> also see each person’s tokens, cost, conversations and alteria questions.</>,
        <><B>Allowances:</B> each person can use a share of the workspace’s monthly budget: members 50% and viewers 25% by default, owners and admins no limit. Owners and admins change the share per role or per person in <B>Settings → Usage → Allowances</B>, with a confirmation that shows every change. Past their allowance, a person’s runs and questions wait until it’s raised or the month resets.</>,
      ]} />
    </>
  )
}

export function CurrencyDoc() {
  return (
    <>
      <Lead>Prices are shown, and charged, in your local currency.</Lead>
      <P>aftercall picks the currency from where you are. Prices are set per region, so they may differ between countries. The pricing page and checkout say which currency and rate apply.</P>
      <P>Discount codes are entered at checkout. Some apply only to top-ups or only to Pro, only in some countries, or only on a first payment.</P>
    </>
  )
}

// ── FAQ and support ────────────────────────────────────────────────────────────

export function FaqDoc() {
  return (
    <>
      <Lead>Short answers to what people ask most.</Lead>
      <H2>Getting started</H2>
      <Faq items={[
        { q: 'What does aftercall do?', a: 'It asks every conversation the same questions and gives each answer a confidence score, so you can see patterns across thousands of calls and chats.' },
        { q: 'What’s the difference between a tracker and a signal?', a: 'A signal is one question. A tracker is a group of signals about one topic.' },
        { q: 'Which file formats work?', a: <>CSV, JSON, JSONL, plain text and VTT or SRT subtitles, in any layout. <A to="/docs/analysing-conversations">Details</A></> },
        { q: 'Do I have to prepare my files?', a: 'No. Upload transcripts as they are; aftercall shows what it read before anything runs.' },
      ]} />
      <H2>Pricing and billing</H2>
      <Faq items={[
        { q: 'How is a run priced?', a: 'Per token: the transcript plus the signals you chose. You see the cost before it runs, and pay only what it used.' },
        { q: 'Am I charged for conversations that fail or are too long?', a: 'No. Conversations over the size limit aren’t run and cost nothing.' },
        { q: 'Can I cancel Pro?', a: 'Yes, any time in Settings → Plan and credits. Pro stays until the end of the month you paid for.' },
        { q: 'Do viewers cost anything?', a: 'Viewer seats are free. If a viewer asks alteria, it’s charged from the workspace’s credits like anyone’s questions, within their allowance.' },
      ]} />
      <H2>Account and data</H2>
      <Faq items={[
        { q: 'Why was I signed out?', a: 'Google ended the session, or you signed out on another device. Sign in again and you’ll return to the page you were on.' },
        { q: 'Who can see my conversations?', a: 'People in your workspace, by role. aftercall staff only look when you ask for support.' },
        { q: 'How do I delete data?', a: <>Delete uploads or conversations from Results. To delete the whole workspace, the owner can email <A to={`mailto:${SUPPORT}`}>{SUPPORT}</A>.</> },
        { q: 'Is there an API?', a: 'Not yet. It’s being built, along with ways to send conversations from call platforms automatically.' },
      ]} />
    </>
  )
}

export function SupportDoc() {
  return (
    <>
      <Lead>We’re here to help. Real people answer every message.</Lead>
      <H2>Contact support</H2>
      <P>Email <A to={`mailto:${SUPPORT}`}>{SUPPORT}</A>. We aim to reply within one business day. To help us help you faster, include:</P>
      <List items={['Your workspace’s address (Settings → Workspace)', 'The page and what you expected to happen', 'A screenshot, and the time it happened']} />
      <H2>Report a security issue</H2>
      <P>Email <A to={`mailto:${SECURITY}`}>{SECURITY}</A> with the details and steps to reproduce. Please don’t test against other customers’ data. We’ll confirm we received it and keep you updated. <A to="/docs/security">Security</A></P>
      <H2>Sales and everything else</H2>
      <P><A to={`mailto:${CONTACT}`}>{CONTACT}</A></P>
    </>
  )
}
