// API docs: connectors. What each platform sends, how to link it, and what's mapped. The framework
// and the order they ship in are in docs/api-connectors-plan.md §4 (B61).
import { HOST } from '../../config'
import { A, B, Code, H2, H3, Lead, List, Note, P, Steps, Table } from '../kit'
import { API } from './guides'
import { Cards, Sample, StageTag, type Stage } from './kit'

const HOOK = `https://api.${HOST}/v1/hooks`

const catalog: { group: string; items: { name: string; what: string; how: string; stage: Stage; to: string }[] }[] = [
  {
    group: 'Voice agents',
    items: [
      { name: 'Vapi', what: 'Every call, with the transcript and call details', how: 'Server URL', stage: 'tier 1', to: 'voice-agents#vapi' },
      { name: 'Retell AI', what: 'Every call, when its analysis is done', how: 'Webhook', stage: 'tier 1', to: 'voice-agents#retell-ai' },
      { name: 'ElevenLabs Conversational AI', what: 'Every conversation', how: 'Post-call webhook', stage: 'tier 1', to: 'voice-agents#elevenlabs' },
      { name: 'Bland', what: 'Every call', how: 'Webhook', stage: 'tier 1', to: 'voice-agents#bland' },
      { name: 'LiveKit and Pipecat', what: 'Calls from agents you host', how: 'A few lines at call end', stage: 'tier 1', to: 'voice-agents#livekit-and-pipecat' },
    ],
  },
  {
    group: 'Phone systems and meetings',
    items: [
      { name: 'Twilio', what: 'Voice Intelligence transcripts, and Conversations', how: 'OAuth + webhook', stage: 'tier 1', to: 'twilio' },
      { name: 'Aircall', what: 'Call transcripts from Aircall AI', how: 'OAuth', stage: 'tier 2', to: 'call-platforms#aircall' },
      { name: 'Dialpad', what: 'Call transcripts', how: 'OAuth', stage: 'tier 2', to: 'call-platforms#dialpad' },
      { name: 'RingCentral', what: 'Call transcripts (RingSense)', how: 'OAuth', stage: 'tier 2', to: 'call-platforms#ringcentral' },
      { name: 'Zoom', what: 'Zoom Phone and meeting transcripts', how: 'OAuth', stage: 'tier 2', to: 'call-platforms#zoom' },
      { name: 'Google Meet', what: 'Meeting transcripts', how: 'OAuth', stage: 'tier 2', to: 'call-platforms#google-meet-and-microsoft-teams' },
      { name: 'Microsoft Teams', what: 'Meeting and call transcripts', how: 'OAuth', stage: 'tier 2', to: 'call-platforms#google-meet-and-microsoft-teams' },
      { name: 'Genesys Cloud', what: 'Contact-centre transcripts', how: 'OAuth', stage: 'tier 3', to: 'call-platforms#contact-centres' },
      { name: 'Five9', what: 'Contact-centre transcripts', how: 'API key', stage: 'tier 3', to: 'call-platforms#contact-centres' },
      { name: 'Talkdesk', what: 'Contact-centre transcripts', how: 'OAuth', stage: 'tier 3', to: 'call-platforms#contact-centres' },
      { name: 'Amazon Connect', what: 'Contact Lens transcripts from S3', how: 'IAM role', stage: 'tier 3', to: 'call-platforms#contact-centres' },
      { name: 'Gong', what: 'Sales call transcripts', how: 'OAuth', stage: 'tier 3', to: 'call-platforms#sales-calls' },
      { name: 'Chorus', what: 'Sales call transcripts', how: 'API key', stage: 'tier 3', to: 'call-platforms#sales-calls' },
    ],
  },
  {
    group: 'Chats and help desks',
    items: [
      { name: 'Intercom', what: 'Closed conversations', how: 'OAuth', stage: 'tier 3', to: 'help-desks#intercom' },
      { name: 'Zendesk', what: 'Solved tickets and chats', how: 'OAuth', stage: 'tier 3', to: 'help-desks#zendesk' },
      { name: 'Freshdesk', what: 'Resolved tickets', how: 'API key', stage: 'tier 3', to: 'help-desks#freshdesk-and-front' },
      { name: 'Front', what: 'Archived conversations', how: 'OAuth', stage: 'tier 3', to: 'help-desks#freshdesk-and-front' },
      { name: 'WhatsApp Business', what: 'Chats, through the Cloud API', how: 'Meta app', stage: 'tier 3', to: 'help-desks#whatsapp-business' },
    ],
  },
  {
    group: 'Results out',
    items: [
      { name: 'Webhooks', what: 'Any system, in real time', how: 'Endpoint URL', stage: 'tier 1', to: 'webhooks' },
      { name: 'Zapier, Make, n8n', what: 'Thousands of apps, no code', how: 'App', stage: 'tier 2', to: 'no-code' },
      { name: 'HubSpot', what: 'Answers on calls and contacts', how: 'OAuth', stage: 'tier 2', to: 'crm#hubspot' },
      { name: 'Salesforce', what: 'Answers on tasks, contacts and cases', how: 'OAuth', stage: 'tier 2', to: 'crm#salesforce' },
      { name: 'Slack', what: 'Alerts and a weekly digest', how: 'OAuth', stage: 'tier 2', to: 'slack-and-teams' },
      { name: 'Microsoft Teams', what: 'Alerts and a weekly digest', how: 'OAuth', stage: 'tier 2', to: 'slack-and-teams' },
      { name: 'Google Sheets', what: 'A sheet that fills itself', how: 'OAuth', stage: 'tier 3', to: 'warehouses#google-sheets' },
      { name: 'BigQuery, Snowflake', what: 'Results tables for BI', how: 'Service account', stage: 'tier 3', to: 'warehouses#bigquery-and-snowflake' },
      { name: 'S3, GCS', what: 'Daily files of results', how: 'IAM role', stage: 'tier 3', to: 'warehouses#s3-and-gcs' },
    ],
  },
]

export function ConnectorsOverview() {
  return (
    <>
      <Lead>Connectors link aftercall to the tools you already use. Conversations come in by themselves as they happen, and answers go back out to where your team works. No code, and no files to export.</Lead>
      <H2>How connecting works</H2>
      <Steps items={[
        { title: 'Open Settings → Integrations', body: 'Owners and admins see every connector. Pick one.' },
        { title: 'Sign in to the other tool', body: 'Most connect with OAuth: you sign in there and approve access. A few take an API key or a webhook URL instead.' },
        { title: 'Choose the project', body: 'Conversations from this connection go to one project, and run with its auto-run rule.' },
        { title: 'Backfill, if you want', body: 'Bring in history, like the last 30 days, with an estimate of the cost before anything runs.' },
      ]} />
      <P>Each connection then shows its health: when it last synced, conversations in the last 24 hours, and any error. If it stops working, owners and admins get a notification and <Code>connection.error</Code> fires.</P>
      <Note>Connectors push through the same API as your own code, so everything in <A to="/docs/api/push-conversations">Push conversations</A> applies: dedupe, <A to="/docs/api/auto-run">auto-run rules and the daily cap</A>, and <Code>waiting_for_credits</Code>.</Note>
      <H2>Every connector</H2>
      <P><StageTag stage="tier 1" /> ships first, <StageTag stage="tier 2" /> next, <StageTag stage="tier 3" /> after that. Missing yours? Any platform that can send a webhook works today: <A to="/docs/api/custom-platform">Any other platform</A>.</P>
      {catalog.map((g) => (
        <div key={g.group}>
          <H3>{g.group}</H3>
          <Table head={['Connector', 'What comes through', 'Connects with', '']} rows={g.items.map((c) => [
            <A to={`/docs/api/${c.to}`}>{c.name}</A>, c.what, c.how, <StageTag stage={c.stage} />,
          ])} />
        </div>
      ))}
      <H2>Security</H2>
      <List items={[
        'Access tokens are encrypted with a key held in a key management service, never logged, and only read by the sync workers.',
        'aftercall asks for read-only access to conversations wherever the other tool allows it. Outbound connectors (CRM, Slack) only get the permissions they write with.',
        'Disconnecting revokes the token at the other tool and deletes it here. Conversations already analysed stay, unless you delete them.',
      ]} />
    </>
  )
}

export function VoiceAgents() {
  return (
    <>
      <Lead>Voice agents are where aftercall helps most: every call your agent takes is checked with the same questions, so you see what changed between prompt versions, and which calls went wrong, the same day.</Lead>
      <P>Each platform sends a report when a call ends. Point it at aftercall and every call arrives with its transcript, and the platform’s call details become metadata you can filter by.</P>
      <H2>Vapi</H2>
      <Steps items={[
        { title: 'Connect in aftercall', body: <>Settings → Integrations → <B>Vapi</B>. Choose the project. You get a URL like <Code>{`${HOOK}/vapi/whk_…`}</Code>.</> },
        { title: 'Set it in Vapi', body: <>In your assistant (or org) settings, set the <B>Server URL</B> to that URL, and turn on the <Code>end-of-call-report</Code> message.</> },
        { title: 'Make a test call', body: 'It appears in the project within seconds.' },
      ]} />
      <Table head={['From Vapi', 'In aftercall']} rows={[
        [<Code>call.id</Code>, <Code>external_id</Code>],
        [<Code>artifact.messages</Code>, 'transcript (bot → agent, user → customer)'],
        [<Code>assistant.id</Code>, <Code>metadata.assistant</Code>],
        [<Code>assistant.metadata.version</Code>, <><Code>metadata.agent_version</Code>, to compare prompt versions</>],
        [<Code>endedReason</Code>, <Code>metadata.ended_reason</Code>],
        [<Code>startedAt</Code>, <Code>started_at</Code>],
      ]} />
      <H2>Retell AI</H2>
      <P>Settings → Integrations → <B>Retell AI</B>, then paste the URL into your agent’s <B>Webhook URL</B> in Retell. aftercall uses the <Code>call_analyzed</Code> event, so Retell’s own summary is there as <Code>metadata.retell_summary</Code>. The agent’s version becomes <Code>metadata.agent_version</Code>.</P>
      <H2 anchor="elevenlabs">ElevenLabs Conversational AI</H2>
      <P>In ElevenLabs, add a <B>post-call webhook</B> with the URL from Settings → Integrations → <B>ElevenLabs</B>, and the HMAC secret it shows. The agent id and any dynamic variables become metadata.</P>
      <H2>Bland</H2>
      <P>Set the call’s <Code>webhook</Code> (or the pathway’s) to the URL from Settings → Integrations → <B>Bland</B>. Pathway name and variables become metadata.</P>
      <H2>LiveKit and Pipecat</H2>
      <P>If you host your own agent, send the transcript when the call ends. With LiveKit Agents:</P>
      <Sample samples={{
        python: `
from aftercall import Aftercall

aftercall = Aftercall()  # reads AFTERCALL_KEY

async def entrypoint(ctx: JobContext):
    session = AgentSession(...)

    async def send_to_aftercall():
        aftercall.conversations.create(
            project="voice-agent",
            external_id=ctx.room.name,
            channel="voice_agent",
            transcript=[
                {"speaker": "agent" if m.role == "assistant" else "customer", "text": m.text_content}
                for m in session.history.items if m.type == "message"
            ],
            metadata={"agent_version": AGENT_VERSION},
            idempotency_key=ctx.room.name,
        )

    ctx.add_shutdown_callback(send_to_aftercall)
    await session.start(agent=MyAgent(), room=ctx.room)`,
        node: `
import Aftercall from 'aftercall'

const aftercall = new Aftercall() // reads AFTERCALL_KEY

ctx.addShutdownCallback(async () => {
  await aftercall.conversations.create({
    project: 'voice-agent',
    external_id: ctx.room.name,
    channel: 'voice_agent',
    transcript: session.history.items
      .filter((m) => m.type === 'message')
      .map((m) => ({ speaker: m.role === 'assistant' ? 'agent' : 'customer', text: m.textContent })),
    metadata: { agent_version: AGENT_VERSION },
  }, { idempotencyKey: ctx.room.name })
})`,
      }} />
      <P>Pipecat is the same idea: collect the context’s messages, and send them in your pipeline’s end-of-call handler.</P>
      <Note kind="tip">Always send <Code>metadata.agent_version</Code>. Then Insights can compare versions side by side, which is how you know a prompt change helped.</Note>
    </>
  )
}

export function Twilio() {
  return (
    <>
      <Lead>Twilio records and transcribes calls with Voice Intelligence. The connector brings each transcript into aftercall when it’s ready, and can bring in Twilio Conversations (SMS, WhatsApp, chat) too.</Lead>
      <H2>Connect</H2>
      <Steps items={[
        { title: 'Turn on Voice Intelligence', body: 'In Twilio, create a Voice Intelligence Service and set your calls to be transcribed (auto-transcribe, or per recording).' },
        { title: 'Connect in aftercall', body: <>Settings → Integrations → <B>Twilio</B>. Sign in with Twilio and choose the account (or subaccount), the Intelligence Service and the project.</> },
        { title: 'Done', body: <>aftercall sets the service’s webhook for you. Each finished transcript arrives as a conversation with the Call SID as <Code>external_id</Code>.</> },
      ]} />
      <H2>What’s mapped</H2>
      <Table head={['From Twilio', 'In aftercall']} rows={[
        [<Code>CallSid</Code>, <Code>external_id</Code>],
        ['Sentences, with channel and times', <>transcript, with <Code>start_ms</Code>; the agent’s channel is set when you connect</>],
        [<Code>From</Code>, <><Code>metadata.from</Code>, hashed unless you choose to keep numbers</>],
        ['Call direction and duration', <><Code>metadata.direction</Code>, <Code>duration_seconds</Code></>],
        ['Customer key on the transcript', <Code>metadata.customer_key</Code>],
      ]} />
      <H2>Without Voice Intelligence</H2>
      <P>If you transcribe elsewhere, push the transcript yourself with the Call SID as <Code>external_id</Code>: <A to="/docs/api/push-conversations">Push conversations</A>.</P>
      <H2>Backfill</H2>
      <P>When connecting, choose how far back to bring existing transcripts from the service. You see the count and the estimate before anything runs.</P>
    </>
  )
}

export function CallPlatforms() {
  return (
    <>
      <Lead>Phone systems and meeting tools transcribe calls already. Connect them once and each transcript arrives in aftercall when the call ends.</Lead>
      <Table head={['Platform', 'Connects with', 'What comes through']} rows={[
        ['Aircall', 'OAuth', 'Transcripts from Aircall AI, with the user, number and tags'],
        ['Dialpad', 'OAuth', 'Call transcripts, with the user, department and call centre'],
        ['RingCentral', 'OAuth', 'RingSense transcripts, with the extension'],
        ['Zoom', 'OAuth', 'Zoom Phone call transcripts and cloud-recorded meeting transcripts'],
        ['Google Meet', 'OAuth (Workspace admin)', 'Meeting transcripts from Drive'],
        ['Microsoft Teams', 'OAuth (Microsoft 365 admin)', 'Meeting and call transcripts, through Microsoft Graph'],
      ]} />
      <H2>Aircall</H2>
      <P>Settings → Integrations → <B>Aircall</B>, sign in and approve. Choose which numbers to include. Aircall tags become <Code>metadata.tags</Code>, and the Aircall user becomes <Code>metadata.agent</Code>.</P>
      <H2>Dialpad</H2>
      <P>Sign in with a Dialpad admin, choose the offices or call centres, and the project. Dialpad’s transcripts arrive when the call is hung up.</P>
      <H2>RingCentral</H2>
      <P>Needs RingSense for transcripts. Sign in with an admin; choose the extensions or call queues.</P>
      <H2>Zoom</H2>
      <P>Choose Zoom Phone, meetings, or both. Meetings need cloud recording with audio transcripts turned on. Choose which users’ meetings to include: aftercall never pulls every meeting in the account by default.</P>
      <H2>Google Meet and Microsoft Teams</H2>
      <P>An admin connects the organisation, then picks the people or groups whose meetings are included. Transcripts must be turned on in Meet or Teams.</P>
      <Note kind="warn">Meetings are often internal. Include only the calls you mean to analyse, like customer calls, and tell the people in them.</Note>
      <H2>Contact centres</H2>
      <P>Genesys Cloud, Five9, Talkdesk and Amazon Connect export transcripts at the end of each interaction. Each is connected by an admin with read-only access to transcripts; queues become <Code>metadata.queue</Code>. Amazon Connect is connected with an IAM role that reads Contact Lens output from your S3 bucket.</P>
      <H2>Sales calls</H2>
      <P>Gong and Chorus already hold your sales calls. Connect with an admin, choose workspaces or teams, and the deal stage at the time of the call becomes <Code>metadata.deal_stage</Code>.</P>
    </>
  )
}

export function HelpDesks() {
  return (
    <>
      <Lead>Chats and tickets are conversations too. aftercall asks them the same questions as calls, so you can compare channels in one place.</Lead>
      <H2>Intercom</H2>
      <P>Sign in with Intercom and choose the inboxes. Each conversation arrives when it’s closed, with <Code>channel: chat</Code>. Fin’s parts are the agent; teammates are the agent too, named in <Code>metadata.agent</Code>. Tags and the team become metadata.</P>
      <H2>Zendesk</H2>
      <P>Sign in as an admin and choose the groups or brands. Tickets arrive when they’re solved: public comments and chat transcripts only, never internal notes.</P>
      <H2>Freshdesk and Front</H2>
      <P>Freshdesk connects with an API key; Front with OAuth. Resolved or archived conversations arrive with their tags and inbox.</P>
      <H2>WhatsApp Business</H2>
      <P>Through the WhatsApp Cloud API: connect your Meta app, and conversations are grouped into sessions (a new one after 24 hours without messages). If you use a platform on top of WhatsApp, like Twilio or Intercom, connect that instead.</P>
      <Note>Only customer-visible text is analysed. Internal notes and private comments are skipped.</Note>
    </>
  )
}

export function Crm() {
  return (
    <>
      <Lead>Put the answers where sales and support already look. After a conversation is analysed, aftercall writes chosen answers onto the matching call and contact in your CRM.</Lead>
      <H2>HubSpot</H2>
      <Steps items={[
        { title: 'Connect', body: <>Settings → Integrations → <B>HubSpot</B>, sign in and approve.</> },
        { title: 'Match conversations to records', body: <>By the phone number or email in <Code>metadata</Code>, or by a HubSpot call id you send as <Code>metadata.hubspot_call_id</Code>.</> },
        { title: 'Choose what to write', body: 'Pick signals, and the property each one fills. aftercall can create the properties for you, in an “aftercall” group.' },
      ]} />
      <P>It can also add a note to the contact’s timeline with the key answers and a link to the conversation.</P>
      <H2>Salesforce</H2>
      <P>The same, on Tasks (logged calls), Contacts, Leads or Cases. An admin installs the aftercall package, which adds the fields; you map signals to fields in aftercall.</P>
      <H2>What’s written</H2>
      <Table head={['Signal type', 'Written as']} rows={[
        ['Yes or no', 'A checkbox, or yes/no text'],
        ['Pick one', 'A dropdown with your options (created to match)'],
        ['Score', 'A number'],
        ['Needs review', 'Optional: a checkbox, so someone can filter for it'],
      ]} />
      <Note>Low-confidence answers are written only if you choose. By default, an answer that needs review waits until someone checks it.</Note>
    </>
  )
}

export function SlackTeams() {
  return (
    <>
      <Lead>Bring what matters into the channel your team already reads: an alert when a signal crosses a line, and a weekly digest of what changed.</Lead>
      <H2>Connect</H2>
      <P>Settings → Integrations → <B>Slack</B> (or <B>Microsoft Teams</B>), approve, and pick the channels aftercall may post in.</P>
      <H2>Alerts</H2>
      <P>On any signal in Insights, choose <B>Alert me</B>, like “when complaints go above 5% of calls in a day”, or “every call where the agent didn’t confirm the booking”. Each alert posts a message with the numbers and links to the conversations.</P>
      <H2>Weekly digest</H2>
      <P>Every Monday: the signals that moved most, the conversations that need review, and the week’s spend. Choose the project and the channel.</P>
      <Note>Messages never include transcripts, only answers and links. Opening a conversation needs an aftercall sign-in.</Note>
    </>
  )
}

export function NoCode() {
  return (
    <>
      <Lead>Zapier, Make and n8n connect aftercall to thousands of other apps without code. They use the same API and webhooks, so anything here works there.</Lead>
      <Table head={['', 'What it does']} rows={[
        [<B>Trigger: Conversation analysed</B>, 'Runs when answers are ready, with every answer as a field'],
        [<B>Trigger: Alert fired</B>, 'Runs when an alert on a signal fires'],
        [<B>Trigger: Needs review</B>, 'Runs when an answer falls under the review line'],
        [<B>Action: Push a conversation</B>, 'Sends a transcript from any app'],
        [<B>Action: Find a conversation</B>, 'By id or your external id'],
      ]} />
      <H2>Examples</H2>
      <List items={[
        'A call where the customer asked to cancel → a task in Asana for the retention team.',
        'Any answer that needs review → a row in a Google Sheet for the QA lead.',
        'A new Typeform or Gmail thread → pushed to aftercall as a conversation.',
      ]} />
      <H2>Connecting</H2>
      <P>Search for “aftercall” in Zapier, Make or n8n, and sign in with an API key from Settings → Developers, with the scopes it asks for.</P>
    </>
  )
}

export function Warehouses() {
  return (
    <>
      <Lead>For BI teams: results land in your own sheet, warehouse or bucket on a schedule, in a table shape that’s easy to join with the rest of your data.</Lead>
      <H2>The tables</H2>
      <Table head={['Table', 'One row per']} rows={[
        [<Code>conversations</Code>, 'Conversation: ids, channel, times, duration, status, and each metadata key as a column'],
        [<Code>results</Code>, 'Answer: conversation, tracker, signal, answer, confidence, needs review, reviewed answer'],
        [<Code>signals</Code>, 'Signal: its tracker, question, type and options, so answers can be labelled'],
      ]} />
      <P>Rows are upserted by id, so corrections after review replace the earlier answer.</P>
      <H2>Google Sheets</H2>
      <P>Connect Google, pick or create a spreadsheet, and choose the project and signals. A row per conversation is added as each one is analysed, with one column per signal.</P>
      <H2>BigQuery and Snowflake</H2>
      <P>Give aftercall a service account (BigQuery) or a user with a role limited to one schema (Snowflake). Choose hourly or daily. Tables are created on the first sync.</P>
      <H2>S3 and GCS</H2>
      <P>Daily files of each table, as Parquet or JSONL, in a bucket you own, written with an IAM role you grant. Partitioned by date.</P>
      <Note>Prefer to pull? <A to="/docs/api/reading-results">Read results</A> shows how to sync with the API instead.</Note>
    </>
  )
}

export function CustomPlatform() {
  return (
    <>
      <Lead>Your platform isn’t listed? If it can send a webhook, or you can run a few lines of code when a conversation ends, it works today.</Lead>
      <H2>If it sends webhooks</H2>
      <P>Create a <B>generic webhook</B> connection in Settings → Integrations. You get a URL. Point your platform at it, send one real payload, and aftercall shows you what it found and lets you map the fields: which one is the id, the transcript, the time, and which become metadata. It reads any layout, the same way it reads uploaded files.</P>
      <Sample title="Your platform sends" samples={{ bash: `
curl ${HOOK}/generic/whk_7Qm2… \\
  -H "Content-Type: application/json" \\
  -d @call-ended.json` }} />
      <H2>If you can run code</H2>
      <P>Push the conversation yourself when it ends:</P>
      <Sample samples={{
        curl: `
curl ${API}/conversations \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Idempotency-Key: $ID" \\
  -H "Content-Type: application/json" \\
  -d "{\\"project\\": \\"support\\", \\"external_id\\": \\"$ID\\", \\"transcript\\": $TRANSCRIPT}"`,
        python: `
client.conversations.create(project="support", external_id=id, transcript=transcript, idempotency_key=id)`,
        node: `
await client.conversations.create({ project: 'support', external_id: id, transcript }, { idempotencyKey: id })`,
      }} />
      <H2>Ask for a connector</H2>
      <P>Tell us what you use at <A to={`mailto:hello@${HOST}`}>{`hello@${HOST}`}</A>. We build the ones most asked for first.</P>
      <Cards items={[
        { to: '/docs/api/push-conversations', title: 'Push conversations', body: 'The endpoint, statuses and guarantees.' },
        { to: '/docs/api/conversation-format', title: 'Transcript formats', body: 'What aftercall reads best.' },
      ]} />
    </>
  )
}
