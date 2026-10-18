// API docs guides: getting started, how the API works, sending conversations, getting results, and
// AI access. Written for developers wiring aftercall into their systems. The design is in
// docs/api-connectors-plan.md (B59 to B62); until those ship, every page shows the preview notice.
import { HOST } from '../../config'
import { A, B, Code, H2, H3, Lead, List, Note, P, Steps, Table } from '../kit'
import { Fields, Route, Sample } from './kit'

export const API = `https://api.${HOST}/v1`
export const VERSION = '2026-10-01'
export const MCP = `https://mcp.${HOST}`

// ── Get started ───────────────────────────────────────────────────────────────

export function Quickstart() {
  return (
    <>
      <Lead>Send one conversation to aftercall, and read back its answers. It takes about five minutes with a test key, and costs nothing.</Lead>
      <Steps items={[
        { title: 'Create a test key', body: <>In the app, open <B>Settings → Developers</B> and choose <B>Create key</B>. Pick <B>Test</B>, give it a name, and copy it: it starts with <Code>ac_test_</Code> and is shown once. Owners and admins can create keys.</> },
        { title: 'Set up a tracker', body: <>The conversation is analysed with your project’s trackers. If the project has none yet, start from a template in <B>Trackers</B>. <A to="/docs/trackers-and-signals">Trackers and signals</A></> },
        { title: 'Push a conversation', body: <>Send the transcript to <Code>POST /v1/conversations</Code>, as below. aftercall answers <Code>202</Code> at once, with an id and the estimated cost.</> },
        { title: 'Read the answers', body: <>A few seconds later, get the conversation back with its results. In production you’d use a <A to="/docs/api/webhooks">webhook</A> instead of asking.</> },
      ]} />
      <H2>Push a conversation</H2>
      <Sample samples={{
        curl: `
curl ${API}/conversations \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project": "front-desk",
    "external_id": "call_8f2a",
    "channel": "call",
    "transcript": [
      {"speaker": "agent", "text": "Sunrise Clinic, how can I help?"},
      {"speaker": "customer", "text": "I need to move my appointment to Friday."},
      {"speaker": "agent", "text": "Done: Friday at 10. You will get a text."}
    ]
  }'`,
        python: `
import os, uuid
from aftercall import Aftercall

client = Aftercall(api_key=os.environ["AFTERCALL_KEY"])

conversation = client.conversations.create(
    project="front-desk",
    external_id="call_8f2a",
    channel="call",
    transcript=[
        {"speaker": "agent", "text": "Sunrise Clinic, how can I help?"},
        {"speaker": "customer", "text": "I need to move my appointment to Friday."},
        {"speaker": "agent", "text": "Done: Friday at 10. You will get a text."},
    ],
    idempotency_key=str(uuid.uuid4()),
)
print(conversation.id, conversation.status)`,
        node: `
import Aftercall from 'aftercall'

const client = new Aftercall({ apiKey: process.env.AFTERCALL_KEY })

const conversation = await client.conversations.create({
  project: 'front-desk',
  external_id: 'call_8f2a',
  channel: 'call',
  transcript: [
    { speaker: 'agent', text: 'Sunrise Clinic, how can I help?' },
    { speaker: 'customer', text: 'I need to move my appointment to Friday.' },
    { speaker: 'agent', text: 'Done: Friday at 10. You will get a text.' },
  ],
}, { idempotencyKey: crypto.randomUUID() })

console.log(conversation.id, conversation.status)`,
      }} />
      <Sample title="202 Accepted" samples={{ json: `
{
  "id": "conv_01J9ZK4T6Q",
  "object": "conversation",
  "status": "queued",
  "external_id": "call_8f2a",
  "project": "front-desk",
  "estimate": { "tokens": 412, "cost_usd": 0.0002 },
  "livemode": false
}` }} />
      <H2>Read the answers</H2>
      <Sample samples={{
        curl: `
curl ${API}/conversations/conv_01J9ZK4T6Q \\
  -H "Authorization: Bearer $AFTERCALL_KEY"`,
        python: `
conversation = client.conversations.retrieve("conv_01J9ZK4T6Q")
for r in conversation.results:
    print(r.signal, r.answer, r.confidence)`,
        node: `
const conversation = await client.conversations.retrieve('conv_01J9ZK4T6Q')
for (const r of conversation.results) console.log(r.signal, r.answer, r.confidence)`,
      }} />
      <Sample title="200 OK" samples={{ json: `
{
  "id": "conv_01J9ZK4T6Q",
  "object": "conversation",
  "status": "analyzed",
  "results": [
    {
      "tracker": "booking",
      "signal": "booking_changed",
      "question": "Did the agent change the booking?",
      "answer": "yes",
      "confidence": 0.97,
      "needs_review": false
    },
    {
      "tracker": "booking",
      "signal": "call_reason",
      "question": "Why did the customer call?",
      "answer": "reschedule",
      "confidence": 0.94,
      "needs_review": false
    }
  ]
}` }} />
      <Note kind="tip">In test mode the answers are sample answers, the same every time, so you can write tests against them. <A to="/docs/api/test-mode">Test mode</A></Note>
      <H2>Next steps</H2>
      <List items={[
        <><A to="/docs/api/webhooks">Webhooks</A>: get <Code>conversation.analyzed</Code> as soon as answers are ready.</>,
        <><A to="/docs/api/connectors">Connectors</A>: link Twilio, Vapi, Retell, Aircall or Intercom without writing code.</>,
        <><A to="/docs/api/auto-run">Auto-run rules and caps</A>: choose what runs on pushed conversations, and set a daily limit.</>,
        <><A to="/docs/api/mcp">MCP server</A>: ask aftercall questions from Claude or ChatGPT.</>,
      ]} />
    </>
  )
}

export function Authentication() {
  return (
    <>
      <Lead>Every request carries a secret API key in the <Code>Authorization</Code> header. Keys belong to a workspace, not a person, so integrations keep working when people leave.</Lead>
      <Sample samples={{ curl: `
curl ${API}/projects \\
  -H "Authorization: Bearer ac_live_4eC39HqLyjWDarjtT1zdp7dc"` }} />
      <H2>Live and test keys</H2>
      <Table head={['Prefix', 'Mode', 'What it does']} rows={[
        [<Code>ac_live_</Code>, 'Live', 'Reads and writes your real data. Runs are charged from the workspace’s credits.'],
        [<Code>ac_test_</Code>, 'Test', <>A separate, empty copy of the workspace. Runs return sample answers and cost nothing. <A to="/docs/api/test-mode">Test mode</A></>],
      ]} />
      <H2>Creating a key</H2>
      <P>Owners and admins create keys in <B>Settings → Developers</B>. Each key has:</P>
      <List items={[
        <><B>A name</B>, like “Vapi production”, so the logs say who called.</>,
        <><B>Scopes</B>: what it may do. Give each integration only what it needs.</>,
        <><B>Projects</B> (optional): limit the key to some projects. A key limited to one project doesn’t need <Code>project</Code> in requests.</>,
        <><B>An expiry</B> (optional): the key stops working on that date. You’ll get an email a week before.</>,
      ]} />
      <P>The full key is shown once. aftercall stores only a hash, so a lost key can’t be recovered: create a new one.</P>
      <H2>Scopes</H2>
      <Table head={['Scope', 'Allows']} rows={[
        [<Code>conversations:write</Code>, 'Push conversations and uploads, and delete conversations'],
        [<Code>conversations:read</Code>, 'Read conversations and their transcripts'],
        [<Code>results:read</Code>, 'Read answers and insights'],
        [<Code>runs:write</Code>, 'Start runs over conversations already sent'],
        [<Code>trackers:read</Code>, 'Read trackers and signals'],
        [<Code>trackers:write</Code>, 'Create and change trackers and signals'],
        [<Code>webhooks:write</Code>, 'Manage webhook endpoints'],
      ]} />
      <Note>A transcript pusher only needs <Code>conversations:write</Code>. A BI sync only needs <Code>results:read</Code>.</Note>
      <H2>Keys and plans</H2>
      <P>A key acts as its workspace, within its scopes. The workspace’s plan and limits apply: calls that need Pro return <Code>403</Code> with the type <Code>plan_required</Code>, and runs are held and charged from credits the same way as in the app. <A to="/docs/plans">Plans and pricing</A></P>
      <H2>Keeping keys safe</H2>
      <List items={[
        'Keep keys on your server, in an environment variable or a secrets manager. Never put one in a web page, a mobile app or a repository.',
        <>To rotate a key: create a new one, deploy it, then <B>Revoke</B> the old one. Revoking takes effect within a minute.</>,
        <>Every key shows when it was last used, and from where. Revoke any you don’t recognise.</>,
        <>If a key leaks, revoke it at once and email <A to={`mailto:security@${HOST}`}>{`security@${HOST}`}</A>. aftercall is registered with GitHub secret scanning, so a key pushed to a public repository is revoked and you’re emailed.</>,
      ]} />
      <H2>Authentication errors</H2>
      <Table head={['Status', 'Type', 'Why']} rows={[
        ['401', <Code>authentication</Code>, 'No key, a mistyped key, or a revoked or expired one'],
        ['403', <Code>permission</Code>, 'The key lacks the scope, or the project is outside its projects'],
        ['403', <Code>plan_required</Code>, 'The workspace’s plan doesn’t include this'],
      ]} />
    </>
  )
}

export function TestMode() {
  return (
    <>
      <Lead>Test mode is a separate, empty copy of your workspace. Build and test the whole integration with an <Code>ac_test_</Code> key, and nothing touches your real data or credits.</Lead>
      <H2>What’s different</H2>
      <Table head={['', 'Live', 'Test']} rows={[
        ['Key prefix', <Code>ac_live_</Code>, <Code>ac_test_</Code>],
        ['Data', 'Your real conversations and results', 'Its own; starts empty, with your trackers copied in'],
        ['Answers', 'From the model', 'Sample answers: fixed per signal, so tests are repeatable'],
        ['Cost', 'Charged from credits', 'Free'],
        ['Webhooks', 'To live endpoints', <>To test endpoints only; each event has <Code>"livemode": false</Code></>],
        ['Limits', 'Your plan', '1,000 conversations a day, 10 requests a second'],
      ]} />
      <H2>Forcing an outcome</H2>
      <P>To test how your code handles each case, set <Code>metadata.test_outcome</Code> on a pushed conversation:</P>
      <Table head={['Value', 'What happens']} rows={[
        [<Code>analyzed</Code>, 'The default: answers arrive, all above the review line'],
        [<Code>needs_review</Code>, 'One answer comes back below the review line'],
        [<Code>failed</Code>, <>The conversation fails and <Code>conversation.failed</Code> fires</>],
        [<Code>waiting_for_credits</Code>, <>The run waits as if credits ran out, and <Code>credits.low</Code> fires</>],
      ]} />
      <Note>Test data is kept for 30 days. Clear it any time in <B>Settings → Developers → Test data</B>.</Note>
    </>
  )
}

// ── How the API works ─────────────────────────────────────────────────────────

export function Errors() {
  return (
    <>
      <Lead>aftercall uses HTTP status codes, and every error has the same body: a type to branch on, a code for the detail, and a message for people.</Lead>
      <Sample title="422 Unprocessable Entity" samples={{ json: `
{
  "error": {
    "type": "invalid_request",
    "code": "transcript_empty",
    "message": "The transcript has no text. Send at least one turn.",
    "param": "transcript",
    "request_id": "req_7Hq2mV9x",
    "doc_url": "https://${HOST}/docs/api/errors#transcript_empty"
  }
}` }} />
      <H2>Status codes</H2>
      <Table head={['Status', 'Means']} rows={[
        ['200, 201', 'It worked'],
        ['202', 'Accepted: stored, and the work happens next (pushes and runs)'],
        ['400', 'The request can’t be read: bad JSON, a wrong header'],
        ['401', 'No valid API key'],
        ['403', 'The key can’t do this, or the plan doesn’t include it'],
        ['404', 'It doesn’t exist, or the key can’t see it'],
        ['409', 'A conflict: the idempotency key was used with a different body, or it’s already running'],
        ['413', 'Too large: use an upload instead'],
        ['422', 'Well formed, but a value isn’t allowed'],
        ['429', <>Too many requests. <A to="/docs/api/rate-limits">Rate limits</A></>],
        ['500, 502, 503', 'Our fault. Retry with backoff; with an idempotency key, it’s safe'],
      ]} />
      <H2>Error types</H2>
      <Table head={['Type', 'What to do']} rows={[
        [<Code>invalid_request</Code>, <>Fix the request. <Code>param</Code> names the field.</>],
        [<Code>authentication</Code>, 'Check the key is right and not revoked.'],
        [<Code>permission</Code>, 'Give the key the scope or project, in Settings → Developers.'],
        [<Code>plan_required</Code>, 'The workspace needs Pro for this. The message says which feature.'],
        [<Code>not_found</Code>, 'Check the id, and that it’s in the same mode (live or test).'],
        [<Code>conflict</Code>, 'Wait for the other request, or use a new idempotency key.'],
        [<Code>rate_limited</Code>, <>Wait for <Code>Retry-After</Code> seconds, then retry.</>],
        [<Code>api_error</Code>, 'Retry with backoff. If it persists, send us the request_id.'],
      ]} />
      <H2>Codes you’ll meet most</H2>
      <Table head={['Code', 'Means']} rows={[
        [<Code>transcript_empty</Code>, 'No text in the transcript'],
        [<Code>transcript_too_large</Code>, 'Over the size limit for one conversation; it’s stored but won’t run'],
        [<Code>project_not_found</Code>, 'No project with that id or slug'],
        [<Code>tracker_not_found</Code>, 'A tracker in run.trackers doesn’t exist'],
        [<Code>batch_too_large</Code>, 'More than 500 conversations in one batch'],
        [<Code>idempotency_mismatch</Code>, 'The key was used before with a different body'],
        [<Code>insufficient_credits</Code>, 'Only on runs you start yourself; pushed ones wait instead'],
      ]} />
      <H2>Request ids</H2>
      <P>Every response has a <Code>Request-Id</Code> header, and every error repeats it. Log it: with it, support can find exactly what happened.</P>
    </>
  )
}

export function Pagination() {
  return (
    <>
      <Lead>Every list endpoint returns pages, and a cursor to the next one. Cursors stay correct while new items arrive, unlike page numbers.</Lead>
      <Fields title="Parameters" items={[
        { name: 'limit', type: 'integer', desc: 'How many to return, 1 to 100. Default 20.' },
        { name: 'starting_after', type: 'string', desc: <>A cursor: the <Code>next_cursor</Code> from the previous page.</> },
      ]} />
      <Sample title="200 OK" samples={{ json: `
{
  "object": "list",
  "data": [ { "id": "conv_01J9ZK4T6Q", "object": "conversation" } ],
  "has_more": true,
  "next_cursor": "conv_01J9ZK4T6Q"
}` }} />
      <H2>Walking every page</H2>
      <P>The SDKs page for you: loop over the list and they fetch the next page when needed.</P>
      <Sample samples={{
        python: `
for conversation in client.conversations.list(project="front-desk", limit=100):
    print(conversation.id)`,
        node: `
for await (const conversation of client.conversations.list({ project: 'front-desk', limit: 100 })) {
  console.log(conversation.id)
}`,
        curl: `
curl "${API}/conversations?project=front-desk&limit=100&starting_after=conv_01J9ZK4T6Q" \\
  -H "Authorization: Bearer $AFTERCALL_KEY"`,
      }} />
      <Note>Lists are newest first. To sync everything since a point in time, use <Code>since</Code> on <A to="/docs/api/reference-results">Results</A>, which returns oldest first.</Note>
    </>
  )
}

export function Idempotency() {
  return (
    <>
      <Lead>Networks fail. An idempotency key lets you retry a request without doing it twice: the second time, aftercall returns the first response.</Lead>
      <Sample samples={{ curl: `
curl ${API}/conversations \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \\
  -H "Content-Type: application/json" \\
  -d '{"project": "front-desk", "transcript": "..."}'` }} />
      <H2>How it works</H2>
      <List items={[
        <>Send <Code>Idempotency-Key</Code> on any <Code>POST</Code>. Use a UUID, or anything unique up to 255 characters.</>,
        'aftercall keeps the key and the response for 24 hours. The same key again returns the same response, with the header Idempotent-Replayed: true.',
        <>The same key with a different body returns <Code>409</Code> <Code>idempotency_mismatch</Code>.</>,
        <>While the first request is still being handled, a repeat gets <Code>409</Code> <Code>conflict</Code>. Retry after a second.</>,
      ]} />
      <H2>external_id: dedupe that never expires</H2>
      <P>For conversations there’s a second guard. Set <Code>external_id</Code> to your platform’s id for the call or chat. A conversation with an <Code>external_id</Code> the project already has isn’t stored again; you get the existing one back with <Code>"duplicate": true</Code>. That covers platforms that send the same webhook twice, days apart.</P>
      <H2>When to retry</H2>
      <Table head={['Response', 'Retry?']} rows={[
        ['Network error, timeout', 'Yes, with the same key'],
        ['429', <>Yes, after <Code>Retry-After</Code></>],
        ['500, 502, 503', 'Yes, with exponential backoff: 1s, 2s, 4s… up to 5 tries'],
        ['400, 401, 403, 404, 422', 'No: the same request will fail the same way'],
      ]} />
    </>
  )
}

export function Versioning() {
  return (
    <>
      <Lead>The API has dated versions. Your integration keeps the behaviour it was built against until you choose to upgrade.</Lead>
      <H2>How versions are chosen</H2>
      <List items={[
        <>Each key is pinned to the latest version on the day it’s created. Today that’s <Code>{VERSION}</Code>.</>,
        <>To use another version for one request, send <Code>Aftercall-Version</Code>. Each response says which version answered.</>,
        <>Webhook events are shaped by the version of the endpoint, set when you create it.</>,
      ]} />
      <Sample samples={{ curl: `
curl ${API}/conversations/conv_01J9ZK4T6Q \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Aftercall-Version: ${VERSION}"` }} />
      <H2>What changes without a new version</H2>
      <P>These are safe for well-written code, so they can happen any time:</P>
      <List items={[
        'New endpoints, and new optional parameters',
        'New fields in responses and events',
        'New event types (endpoints only get the ones they subscribed to)',
        'New error codes within an existing type, and new values in lists like channel',
        'The order of fields in JSON, and the length or format of ids',
      ]} />
      <P>Anything else, like renaming or removing a field or changing what a value means, only happens in a new version, listed in the <A to="/docs/api/changelog">changelog</A> with how to upgrade.</P>
      <H2>Upgrading</H2>
      <Steps items={[
        { title: 'Read the changes', body: <>The <A to="/docs/api/changelog">changelog</A> lists each version’s breaking changes.</> },
        { title: 'Test with the header', body: <>Send <Code>Aftercall-Version</Code> with the new date from a test key, and check your code.</> },
        { title: 'Upgrade the key', body: <>In <B>Settings → Developers</B>, choose <B>Upgrade</B> on the key. You can roll back within 72 hours.</> },
      ]} />
      <Note>Old versions are supported for at least 12 months after a new one ships. Keys on a version that’s ending get emails well before.</Note>
    </>
  )
}

export function RateLimits() {
  return (
    <>
      <Lead>Limits keep one busy integration from slowing everyone. They’re per key and per workspace, and every response tells you where you stand.</Lead>
      <Table head={['Traffic', 'Live', 'Test']} rows={[
        ['Pushing conversations', '100 requests a second', '10 a second'],
        ['Batches', '10 a second (up to 500 conversations each)', '2 a second'],
        ['Everything else', '25 a second', '10 a second'],
        ['A workspace, over all its keys', '200 a second', '25 a second'],
      ]} />
      <P>Need more for a backfill? Use <A to="/docs/api/uploads">an upload</A>, which has no rate limit, or <A to="/docs/support">ask us</A> to raise yours.</P>
      <H2>Headers</H2>
      <Table head={['Header', 'Means']} rows={[
        [<Code>RateLimit-Limit</Code>, 'Requests allowed in the window'],
        [<Code>RateLimit-Remaining</Code>, 'Requests left in the window'],
        [<Code>RateLimit-Reset</Code>, 'Seconds until the window resets'],
        [<Code>Retry-After</Code>, <>On a <Code>429</Code>: seconds to wait before retrying</>],
      ]} />
      <H2>Handling 429</H2>
      <Sample samples={{
        python: `
# The SDK retries 429s and 5xxs for you, with backoff. To change it:
client = Aftercall(api_key=key, max_retries=5)`,
        node: `
// The SDK retries 429s and 5xxs for you, with backoff. To change it:
const client = new Aftercall({ apiKey: key, maxRetries: 5 })`,
        curl: `
# Without an SDK: on 429, sleep for Retry-After seconds, then send the
# same request with the same Idempotency-Key.`,
      }} />
      <Note>Rate limits are about speed. How much can be spent is separate: credits, allowances and the <A to="/docs/api/auto-run">daily cap for pushed runs</A>.</Note>
    </>
  )
}

// ── Send conversations ────────────────────────────────────────────────────────

export function PushConversations() {
  return (
    <>
      <Lead>The transcript pusher: send each call or chat to aftercall the moment it ends, and it’s analysed with your trackers. No more exporting files and uploading them.</Lead>
      <H2>Three ways in</H2>
      <Table head={['Endpoint', 'For']} rows={[
        [<Code>POST /v1/conversations</Code>, 'One conversation, right after it ends. Voice agents, call platforms, chat tools.'],
        [<Code>POST /v1/conversations/batch</Code>, 'Up to 500 at once. Nightly syncs, and catching up after an outage.'],
        [<Code>POST /v1/uploads</Code>, <>A big file: history, or an export from another tool. <A to="/docs/api/uploads">Large files</A></>],
      ]} />
      <P>Or skip the code: a <A to="/docs/api/connectors">connector</A> pushes for you.</P>
      <H2>One conversation</H2>
      <Route method="POST" path="/v1/conversations" />
      <Sample samples={{
        curl: `
curl ${API}/conversations \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Idempotency-Key: $CALL_ID" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project": "front-desk",
    "external_id": "CA8f2e91c4",
    "channel": "call",
    "started_at": "2026-09-27T10:15:00Z",
    "duration_seconds": 184,
    "transcript": [
      {"speaker": "agent", "text": "Sunrise Clinic, how can I help?", "start_ms": 0},
      {"speaker": "customer", "text": "Can I move my appointment?", "start_ms": 2100}
    ],
    "metadata": {"agent_version": "v2.3", "team": "front-desk"}
  }'`,
        python: `
client.conversations.create(
    project="front-desk",
    external_id=call.id,
    channel="call",
    started_at=call.started_at,
    duration_seconds=call.duration,
    transcript=call.transcript,           # a list of turns, or plain text
    metadata={"agent_version": "v2.3", "team": "front-desk"},
    idempotency_key=call.id,
)`,
        node: `
await client.conversations.create({
  project: 'front-desk',
  external_id: call.id,
  channel: 'call',
  started_at: call.startedAt,
  duration_seconds: call.duration,
  transcript: call.transcript,            // a list of turns, or plain text
  metadata: { agent_version: 'v2.3', team: 'front-desk' },
}, { idempotencyKey: call.id })`,
      }} />
      <Sample title="202 Accepted" samples={{ json: `
{
  "id": "conv_01J9ZK4T6Q",
  "object": "conversation",
  "status": "queued",
  "duplicate": false,
  "estimate": { "tokens": 2143, "cost_usd": 0.0011 }
}` }} />
      <P>Every field is in the <A to="/docs/api/reference-conversations">reference</A>. The transcript can be in any layout: <A to="/docs/api/conversation-format">Transcript formats</A>.</P>
      <H2>A batch</H2>
      <Route method="POST" path="/v1/conversations/batch" />
      <Sample samples={{
        curl: `
curl ${API}/conversations/batch \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Idempotency-Key: nightly-2026-09-27" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project": "front-desk",
    "conversations": [
      {"external_id": "CA01", "transcript": "..."},
      {"external_id": "CA02", "transcript": "..."}
    ]
  }'`,
        python: `
client.conversations.batch(project="front-desk", conversations=calls, idempotency_key="nightly-2026-09-27")`,
        node: `
await client.conversations.batch({ project: 'front-desk', conversations: calls }, { idempotencyKey: 'nightly-2026-09-27' })`,
      }} />
      <Sample title="202 Accepted" samples={{ json: `
{
  "object": "batch",
  "accepted": 498,
  "duplicates": 1,
  "rejected": [
    { "index": 37, "external_id": "CA38", "error": { "code": "transcript_empty", "message": "The transcript has no text." } }
  ],
  "estimate": { "tokens": 1048211, "cost_usd": 0.52 }
}` }} />
      <P>A batch is accepted as a whole, even when some items aren’t: the rejected ones are listed with why, and you can send just those again.</P>
      <H2>What happens next</H2>
      <Steps items={[
        { title: 'Stored', body: <>The <Code>202</Code> means it’s saved. From here, nothing is lost: not a slow model, a full queue or empty credits.</> },
        { title: 'Read', body: 'aftercall turns the transcript into turns and speakers, whatever the layout.' },
        { title: 'Run', body: <>If the project’s <A to="/docs/api/auto-run">auto-run rule</A> says so, its trackers run. The estimate is held from credits, and only what’s used is charged.</> },
        { title: 'Ready', body: <>Status becomes <Code>analyzed</Code>, and <Code>conversation.analyzed</Code> goes to your <A to="/docs/api/webhooks">webhooks</A>.</> },
      ]} />
      <H2>Statuses</H2>
      <Table head={['Status', 'Means']} rows={[
        [<Code>queued</Code>, 'Stored, waiting to be read and run'],
        [<Code>stored</Code>, <>Stored, and set not to run (<Code>{'"run": "none"'}</Code>, or no auto-run rule)</>],
        [<Code>running</Code>, 'Trackers are running'],
        [<Code>analyzed</Code>, 'Answers are ready'],
        [<Code>waiting_for_credits</Code>, 'Stored, but credits, an allowance or the daily cap ran out. It runs by itself when there’s room again.'],
        [<Code>too_large</Code>, 'Over the size limit for one conversation. Stored, not run, not charged.'],
        [<Code>failed</Code>, <>Couldn’t be read or run. <Code>failure</Code> says why; nothing was charged.</>],
      ]} />
      <H2>Guarantees</H2>
      <List items={[
        <><B>Accepted means stored.</B> Even when credits run out, the conversation waits instead of being dropped.</>,
        <><B>Order doesn’t matter.</B> Send conversations in any order; <Code>started_at</Code> decides where they sit in Insights.</>,
        <><B>Retries are safe</B>, with <A to="/docs/api/idempotency">an idempotency key and external_id</A>.</>,
      ]} />
    </>
  )
}

export function ConversationFormat() {
  return (
    <>
      <Lead>Send transcripts the way your platform gives them to you. aftercall reads any layout, the same way it reads uploaded files. This page shows what it reads best.</Lead>
      <H2>Best: a list of turns</H2>
      <Sample samples={{ json: `
"transcript": [
  { "speaker": "agent", "text": "Sunrise Clinic, how can I help?", "start_ms": 0, "end_ms": 1900 },
  { "speaker": "customer", "text": "Can I move my appointment?", "start_ms": 2100 }
]` }} />
      <Fields title="A turn" items={[
        { name: 'speaker', type: 'string', required: true, desc: <>Who spoke. <Code>agent</Code> and <Code>customer</Code> are understood best; <Code>bot</Code>, <Code>assistant</Code>, <Code>user</Code>, <Code>caller</Code> and names work too.</> },
        { name: 'text', type: 'string', required: true, desc: 'What they said.' },
        { name: 'start_ms', type: 'integer', desc: 'When the turn started, in milliseconds from the start. Lets results link to the moment.' },
        { name: 'end_ms', type: 'integer', desc: 'When it ended.' },
      ]} />
      <H2>Also fine</H2>
      <H3>Plain text</H3>
      <Sample samples={{ json: `
"transcript": "Agent: Sunrise Clinic, how can I help?\\nCustomer: Can I move my appointment?"` }} />
      <H3>Your platform’s own format</H3>
      <P>Send the transcript object from Vapi, Retell, Twilio, Aircall and others as it comes, and set <Code>format</Code> so it’s read without guessing:</P>
      <Sample samples={{ json: `
"format": "vapi",
"transcript": { "messages": [ { "role": "bot", "message": "Hi!", "time": 1727431200000 } ] }` }} />
      <P>Known formats: <Code>vapi</Code>, <Code>retell</Code>, <Code>elevenlabs</Code>, <Code>bland</Code>, <Code>twilio</Code>, <Code>aircall</Code>, <Code>dialpad</Code>, <Code>zoom</Code>, <Code>intercom</Code>, <Code>zendesk</Code>, <Code>openai_messages</Code>, <Code>vtt</Code>, <Code>srt</Code>. Anything else: leave <Code>format</Code> out.</P>
      <H2>Metadata</H2>
      <P>Anything in <Code>metadata</Code> becomes a filter in Insights: compare agent versions, teams, campaigns or regions. Keep values short, and use the same keys every time.</P>
      <Table head={['Key', 'Used for']} rows={[
        [<Code>agent_version</Code>, 'Compare prompts or model versions of a voice agent'],
        [<Code>agent</Code>, 'The person or bot who handled it'],
        [<Code>team</Code>, 'Group results by team'],
        [<Code>campaign</Code>, 'Outbound campaigns'],
        [<Code>language</Code>, 'The conversation’s language, like en or hi'],
      ]} />
      <P>Up to 50 keys; keys up to 40 characters, values up to 500. Don’t put personal data like phone numbers in metadata: it’s shown in filters to everyone in the workspace.</P>
      <H2>Size</H2>
      <P>One conversation can be up to 1 MB of JSON. Transcripts over the size limit for analysis are stored with the status <Code>too_large</Code>, not run, and not charged.</P>
    </>
  )
}

export function Uploads() {
  return (
    <>
      <Lead>For history and big exports, send a file instead of many requests. It goes straight to storage, so there’s no size limit on the request and no rate limit.</Lead>
      <Steps items={[
        { title: 'Ask for an upload', body: <><Code>POST /v1/uploads</Code> with the file name and project. You get an upload id and a URL to send the file to.</> },
        { title: 'Send the file', body: <>A <Code>PUT</Code> of the file to that URL, within an hour. CSV, JSON, JSONL, text, VTT and SRT; up to 5 GB.</> },
        { title: 'Wait for it to be read', body: <><Code>upload.completed</Code> fires with what was found: how many conversations, any skipped and why, and the estimate.</> },
        { title: 'Run it', body: <>With <Code>{'"run": "on_read"'}</Code> it runs at once. Otherwise, start a <A to="/docs/api/reference-runs">run</A> once you’ve checked the estimate.</> },
      ]} />
      <Sample samples={{
        curl: `
# 1. Ask for an upload
curl ${API}/uploads \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project": "front-desk", "filename": "calls-2025.jsonl"}'

# 2. Send the file to upload_url
curl -X PUT "$UPLOAD_URL" --upload-file calls-2025.jsonl`,
        python: `
upload = client.uploads.create(project="front-desk", file=open("calls-2025.jsonl", "rb"))
upload = client.uploads.wait(upload.id)   # until it's read
print(upload.found, upload.skipped, upload.estimate.cost_usd)`,
        node: `
import fs from 'node:fs'

let upload = await client.uploads.create({ project: 'front-desk', file: fs.createReadStream('calls-2025.jsonl') })
upload = await client.uploads.wait(upload.id) // until it's read
console.log(upload.found, upload.skipped, upload.estimate.cost_usd)`,
      }} />
      <Note>Uploads are the same as <B>Analyse calls</B> in the app, and a file of any layout works. The same <A to="/docs/analysing-conversations">formats and limits</A> apply.</Note>
    </>
  )
}

export function AutoRun() {
  return (
    <>
      <Lead>Pushed conversations arrive all day. Each project decides what runs on them, and how much they may spend in a day, so a misbehaving integration can’t drain your credits.</Lead>
      <H2>Auto-run rules</H2>
      <P>Set in the app, in the project’s settings under <B>Pushed conversations</B> (owners and admins):</P>
      <Table head={['Rule', 'What runs']} rows={[
        ['Run the project’s trackers', 'The default. Every tracker that’s on in the project.'],
        ['Run chosen trackers', 'Only the ones you pick, like a short set for every call and the rest on demand.'],
        ['Store only', <>Nothing runs. Start runs yourself from the app or with <A to="/docs/api/reference-runs">the API</A>.</>],
      ]} />
      <P>A request can override the rule with <Code>run</Code>:</P>
      <Sample samples={{ json: `
"run": { "trackers": ["booking", "compliance"] }   // just these
"run": "project_default"                           // the rule (the default)
"run": "none"                                      // store only` }} />
      <H2>The daily cap</H2>
      <P>A spending limit for pushed runs, per project, per day (midnight in the workspace’s time zone). When it’s reached, new conversations are still stored, wait as <Code>waiting_for_credits</Code>, and run the next day, or when you raise the cap.</P>
      <List items={[
        <>The owner and admins get a notification, and <Code>allowance.reached</Code> fires with <Code>{'"reason": "daily_cap"'}</Code>.</>,
        'The cap is empty by default: set one before going live.',
      ]} />
      <H2>When credits run out</H2>
      <P>The same: pushed conversations are never dropped. They wait, <Code>credits.low</Code> fires before it happens, and they run in order once you add credits or <A to="/docs/credits">auto top-up</A> does.</P>
    </>
  )
}

// ── Get results ───────────────────────────────────────────────────────────────

export function ReadingResults() {
  return (
    <>
      <Lead>Every conversation gets an answer to every signal, with a confidence score. Read them for one conversation, sync them all, or have them sent to you.</Lead>
      <H2>For one conversation</H2>
      <Route method="GET" path="/v1/conversations/{id}" />
      <P>The conversation includes <Code>results</Code> once its status is <Code>analyzed</Code>. To look it up by your own id, use <Code>{'GET /v1/conversations?external_id=CA8f2e91c4'}</Code>.</P>
      <H2>A result</H2>
      <Fields items={[
        { name: 'tracker', type: 'string', desc: 'The tracker’s key, like booking.' },
        { name: 'signal', type: 'string', desc: 'The signal’s key, like call_reason.' },
        { name: 'question', type: 'string', desc: 'The question as written, for showing to people.' },
        { name: 'type', type: 'enum', desc: <><Code>yes_no</Code>, <Code>pick_one</Code> or <Code>score</Code>.</> },
        { name: 'answer', type: 'string | number | null', desc: <>The answer: <Code>yes</Code>/<Code>no</Code>, an option’s key, or a number. <Code>null</Code> when a conditional tracker didn’t apply.</> },
        { name: 'confidence', type: 'number', desc: 'From 0 to 1: how sure the answer is. It’s measured, not guessed.' },
        { name: 'needs_review', type: 'boolean', desc: 'True when confidence is under the project’s review line.' },
        { name: 'reviewed', type: 'object | null', desc: 'When a person checked or corrected it: who, when, and the corrected answer.' },
        { name: 'evidence', type: 'array', desc: <>The turns the answer rests on, with <Code>start_ms</Code> when the transcript had times.</> },
      ]} />
      <H2>Sync everything to your warehouse</H2>
      <P>Use <A to="/docs/api/reference-results">Results</A>: every answer across conversations, oldest first, from a point in time. Keep the last cursor and ask again for what’s new.</P>
      <Sample samples={{
        python: `
cursor = load_cursor()
for result in client.results.list(project="front-desk", starting_after=cursor, limit=100):
    warehouse.insert(result)
    cursor = result.id
save_cursor(cursor)`,
        node: `
let cursor = await loadCursor()
for await (const result of client.results.list({ project: 'front-desk', starting_after: cursor, limit: 100 })) {
  await warehouse.insert(result)
  cursor = result.id
}
await saveCursor(cursor)`,
        curl: `
curl "${API}/results?project=front-desk&since=2026-09-01T00:00:00Z&limit=100" \\
  -H "Authorization: Bearer $AFTERCALL_KEY"`,
      }} />
      <P>Corrections made by reviewers show up again with <Code>reviewed</Code> set, so the warehouse always has the latest answer. Or use the <A to="/docs/api/warehouses">warehouse connectors</A>, which do this for you.</P>
    </>
  )
}

export function Webhooks() {
  return (
    <>
      <Lead>Instead of asking whether results are ready, give aftercall a URL. It sends an event there the moment something happens: answers ready, a file read, credits running low.</Lead>
      <H2>Add an endpoint</H2>
      <P>In the app, <B>Settings → Developers → Webhooks → Add endpoint</B>, or with the API:</P>
      <Sample samples={{
        curl: `
curl ${API}/webhook_endpoints \\
  -H "Authorization: Bearer $AFTERCALL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/aftercall/webhook",
    "events": ["conversation.analyzed", "conversation.failed", "credits.low"],
    "project": "front-desk"
  }'`,
        python: `
endpoint = client.webhook_endpoints.create(
    url="https://example.com/aftercall/webhook",
    events=["conversation.analyzed", "conversation.failed", "credits.low"],
    project="front-desk",
)
print(endpoint.secret)  # shown once: store it`,
        node: `
const endpoint = await client.webhookEndpoints.create({
  url: 'https://example.com/aftercall/webhook',
  events: ['conversation.analyzed', 'conversation.failed', 'credits.low'],
  project: 'front-desk',
})
console.log(endpoint.secret) // shown once: store it`,
      }} />
      <P>The response has the endpoint’s signing <Code>secret</Code>, starting <Code>whsec_</Code>. It’s shown once; use it to <A to="/docs/api/verify-webhooks">verify each request</A>. Up to 10 endpoints per workspace.</P>
      <H2>An event</H2>
      <Sample title="POST https://example.com/aftercall/webhook" samples={{ json: `
{
  "id": "evt_01J9ZM2B7R",
  "object": "event",
  "type": "conversation.analyzed",
  "created": 1759140930,
  "api_version": "${VERSION}",
  "livemode": true,
  "data": {
    "object": {
      "id": "conv_01J9ZK4T6Q",
      "object": "conversation",
      "external_id": "CA8f2e91c4",
      "status": "analyzed",
      "needs_review": 0,
      "results": [ { "signal": "call_reason", "answer": "reschedule", "confidence": 0.94 } ]
    }
  }
}` }} />
      <H2>Receiving events</H2>
      <List items={[
        <><B>Answer fast.</B> Return any <Code>2xx</Code> within 10 seconds, then do the work. A slow answer counts as a failure.</>,
        <><B>Verify the signature</B> before trusting anything. <A to="/docs/api/verify-webhooks">Verify signatures</A></>,
        <><B>Expect duplicates.</B> Delivery is at least once. Skip events whose <Code>id</Code> you’ve already handled.</>,
        <><B>Don’t rely on order.</B> Use <Code>created</Code>, or fetch the latest state from the API.</>,
      ]} />
      <H2>Retries</H2>
      <P>A delivery that doesn’t get a <Code>2xx</Code> is retried with exponential backoff for up to 3 days: after about 1 minute, 5 minutes, 30 minutes, 2 hours, then every 6 hours. If an endpoint fails for 3 days straight, it’s turned off and the owner gets an email.</P>
      <H2>Logs, resending and replay</H2>
      <List items={[
        'Each endpoint has a delivery log in Settings → Developers: every attempt, the response code and time, and a Resend button.',
        <>Every event is kept for 30 days. After downtime, list what you missed with <A to="/docs/api/reference-events"><Code>GET /v1/events</Code></A>.</>,
        <><B>Send test event</B> on an endpoint sends a sample of any type.</>,
      ]} />
      <H2>Test locally</H2>
      <P>The aftercall CLI forwards events to your machine, with a temporary secret:</P>
      <Sample samples={{ bash: `
aftercall listen --forward-to localhost:3000/aftercall/webhook` }} />
    </>
  )
}

export function WebhookEvents() {
  const ev: [string, string, string][] = [
    ['conversation.analyzed', 'A conversation’s answers are ready', 'conversation'],
    ['conversation.failed', 'A conversation couldn’t be read or run', 'conversation'],
    ['conversation.reviewed', 'A person checked or corrected an answer', 'conversation'],
    ['conversation.waiting', 'A conversation is waiting for credits, an allowance or the daily cap', 'conversation'],
    ['upload.completed', 'A file has been read (not yet run)', 'upload'],
    ['upload.failed', 'A file couldn’t be read', 'upload'],
    ['run.completed', 'A run over an upload or a set of conversations finished', 'run'],
    ['alert.triggered', 'An alert on a signal fired (coming later)', 'alert'],
    ['credits.low', 'The balance won’t last the week at the current rate', 'balance'],
    ['allowance.reached', 'A person, or a project’s daily cap, hit its limit', 'allowance'],
    ['member.joined', 'Someone joined the workspace', 'member'],
    ['connection.error', 'A connector stopped syncing', 'connection'],
  ]
  return (
    <>
      <Lead>Every event has the same envelope; <Code>data.object</Code> is the thing that changed, as the API would return it.</Lead>
      <Table head={['Event', 'Fires when', 'data.object']} rows={ev.map(([t, w, o]) => [<Code>{t}</Code>, w, <Code>{o}</Code>])} />
      <H2>The envelope</H2>
      <Fields items={[
        { name: 'id', type: 'string', desc: 'Unique per event. Use it to skip duplicates.' },
        { name: 'type', type: 'string', desc: 'One of the types above.' },
        { name: 'created', type: 'timestamp', desc: 'When it happened, in Unix seconds.' },
        { name: 'api_version', type: 'string', desc: 'The version that shaped data. It’s the endpoint’s version.' },
        { name: 'livemode', type: 'boolean', desc: 'False for events from test mode.' },
        { name: 'data.object', type: 'object', desc: 'The object, in full.' },
        { name: 'data.previous', type: 'object', desc: 'For reviewed events: the fields as they were before.' },
      ]} />
      <H2>Examples</H2>
      <H3>conversation.failed</H3>
      <Sample samples={{ json: `
{
  "id": "evt_01J9ZN8C1D",
  "type": "conversation.failed",
  "data": {
    "object": {
      "id": "conv_01J9ZN7Y2P",
      "external_id": "CA91",
      "status": "failed",
      "failure": { "code": "transcript_unreadable", "message": "No speaker turns could be found." }
    }
  }
}` }} />
      <H3>credits.low</H3>
      <Sample samples={{ json: `
{
  "id": "evt_01J9ZQ1A4K",
  "type": "credits.low",
  "data": {
    "object": {
      "object": "balance",
      "available_usd": 4.12,
      "runway_days": 3,
      "auto_top_up": false
    }
  }
}` }} />
      <H3>allowance.reached</H3>
      <Sample samples={{ json: `
{
  "id": "evt_01J9ZR5M3S",
  "type": "allowance.reached",
  "data": {
    "object": {
      "object": "allowance",
      "reason": "daily_cap",
      "project": "front-desk",
      "limit_usd": 20.0,
      "resets_at": 1759190400
    }
  }
}` }} />
    </>
  )
}

export function VerifyWebhooks() {
  return (
    <>
      <Lead>Anyone can send a request to your webhook URL. The signature proves it came from aftercall, wasn’t changed, and isn’t an old request played again.</Lead>
      <H2>The signature header</H2>
      <Sample samples={{ http: `
Aftercall-Signature: t=1759140930,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd` }} />
      <Steps items={[
        { title: 'Split the header', body: <>Take <Code>t</Code> (a timestamp) and every <Code>v1</Code> (there are two while a secret is being rotated).</> },
        { title: 'Build the signed text', body: <>The timestamp, a dot, and the <B>raw</B> request body: <Code>{'{t}.{body}'}</Code>. Use the bytes as they arrived, before any JSON parsing.</> },
        { title: 'Compute and compare', body: <>HMAC-SHA256 of that text with your endpoint’s secret, in hex. Compare it to each <Code>v1</Code> with a constant-time comparison.</> },
        { title: 'Check the time', body: <>Reject it if <Code>t</Code> is more than 5 minutes from now. That stops replays.</> },
      ]} />
      <H2>Code</H2>
      <P>The SDKs have this built in. Without them:</P>
      <Sample samples={{
        node: `
import crypto from 'node:crypto'
import express from 'express'

const app = express()
const secret = process.env.AFTERCALL_WEBHOOK_SECRET

app.post('/aftercall/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('Aftercall-Signature') ?? ''
  const parts = Object.groupBy(header.split(','), (p) => p.split('=')[0])
  const t = parts.t?.[0]?.slice(2)
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${req.body}\`).digest('hex')
  const ok = (parts.v1 ?? []).some((v) => {
    const sig = Buffer.from(v.slice(3))
    return sig.length === expected.length && crypto.timingSafeEqual(sig, Buffer.from(expected))
  })
  if (!ok || Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.sendStatus(400)

  const event = JSON.parse(req.body)
  res.sendStatus(200)           // answer first
  handle(event)                 // then do the work
})

// With the SDK:
// const event = client.webhooks.verify(req.body, req.get('Aftercall-Signature'), secret)`,
        python: `
import hashlib, hmac, os, time
from flask import Flask, request, abort

app = Flask(__name__)
secret = os.environ["AFTERCALL_WEBHOOK_SECRET"].encode()

@app.post("/aftercall/webhook")
def webhook():
    header = request.headers.get("Aftercall-Signature", "")
    items = [p.split("=", 1) for p in header.split(",") if "=" in p]
    t = next((v for k, v in items if k == "t"), "0")
    body = request.get_data()  # raw bytes
    expected = hmac.new(secret, f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    ok = any(hmac.compare_digest(v, expected) for k, v in items if k == "v1")
    if not ok or abs(time.time() - int(t)) > 300:
        abort(400)
    handle(request.get_json())
    return "", 200

# With the SDK:
# event = client.webhooks.verify(body, header, secret)`,
        go: `
func verify(r *http.Request, body []byte, secret string) bool {
	var t string
	var sigs []string
	for _, p := range strings.Split(r.Header.Get("Aftercall-Signature"), ",") {
		k, v, _ := strings.Cut(p, "=")
		if k == "t" {
			t = v
		} else if k == "v1" {
			sigs = append(sigs, v)
		}
	}
	ts, err := strconv.ParseInt(t, 10, 64)
	if err != nil || math.Abs(float64(time.Now().Unix()-ts)) > 300 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(t + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, s := range sigs {
		if hmac.Equal([]byte(s), []byte(expected)) {
			return true
		}
	}
	return false
}`,
        php: `
<?php
$secret = getenv('AFTERCALL_WEBHOOK_SECRET');
$body = file_get_contents('php://input');
$t = null; $sigs = [];
foreach (explode(',', $_SERVER['HTTP_AFTERCALL_SIGNATURE'] ?? '') as $part) {
    [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
    if ($k === 't') $t = $v;
    if ($k === 'v1') $sigs[] = $v;
}
$expected = hash_hmac('sha256', $t . '.' . $body, $secret);
$ok = false;
foreach ($sigs as $s) if (hash_equals($expected, $s)) $ok = true;
if (!$ok || abs(time() - (int) $t) > 300) { http_response_code(400); exit; }

http_response_code(200);
handle(json_decode($body, true));`,
      }} />
      <H2>Rotating the secret</H2>
      <P>Choose <B>Roll secret</B> on the endpoint. For 24 hours (or less, if you choose), events are signed with both the old and new secret, so you can deploy the new one without missing any.</P>
      <Note kind="warn">The most common mistake: verifying a body that a framework has already parsed and re-serialised. The bytes change and the signature never matches. Always verify the raw body.</Note>
    </>
  )
}

// ── AI and agents ─────────────────────────────────────────────────────────────

export function Mcp() {
  return (
    <>
      <Lead>aftercall runs an MCP server, so AI tools can use it directly. Ask Claude “why did cancellations go up last week?” and it searches your conversations, reads the answers, and replies with links to the calls.</Lead>
      <P>MCP (Model Context Protocol) is the open standard AI apps use to reach other tools. Claude, ChatGPT, Cursor, VS Code and many agents support it.</P>
      <Route method="POST" path={MCP.replace('https://', '')} />
      <H2>Connect it</H2>
      <H3>Claude</H3>
      <P>In Claude, open <B>Settings → Connectors → Add custom connector</B>, paste <Code>{MCP}</Code>, and sign in to aftercall. You choose the workspace and project, and what it may do.</P>
      <H3>ChatGPT</H3>
      <P>In <B>Settings → Connectors</B>, add a connector with the URL <Code>{MCP}</Code> and sign in.</P>
      <H3>Cursor, VS Code and Claude Code</H3>
      <Sample title="mcp.json" samples={{ json: `
{
  "mcpServers": {
    "aftercall": {
      "url": "${MCP}"
    }
  }
}` }} />
      <Sample samples={{ bash: `
claude mcp add --transport http aftercall ${MCP}` }} />
      <P>For agents that run unattended, use an API key instead of signing in: send it as <Code>Authorization: Bearer ac_live_…</Code>.</P>
      <H2>Tools</H2>
      <Table head={['Tool', 'What it does', 'Needs']} rows={[
        [<Code>search_conversations</Code>, 'Find conversations by words, answers, dates or metadata', 'Read'],
        [<Code>get_conversation</Code>, 'One conversation: transcript and answers', 'Read'],
        [<Code>ask</Code>, 'alteria’s answer to a question in plain words, with the conversations it cites', 'Read'],
        [<Code>get_insights</Code>, 'A signal’s totals and trend, sliced by metadata', 'Read'],
        [<Code>list_trackers</Code>, 'The project’s trackers and signals', 'Read'],
        [<Code>create_tracker</Code>, 'Add a tracker with signals, as a draft to approve in the app', 'Write'],
        [<Code>push_conversation</Code>, 'Send a transcript to be analysed', 'Write'],
      ]} />
      <H2>Safety</H2>
      <List items={[
        'Read-only unless you allow writing when you connect.',
        'It acts as you: your role and projects decide what it sees, the same as in the app.',
        <>Its use counts against your <A to="/docs/usage">allowance</A>, like asking alteria.</>,
        'Every call is in the workspace’s audit log. Disconnect it any time in Settings → Connected apps.',
      ]} />
      <Note>Viewers can connect it too, read-only, within their allowance.</Note>
    </>
  )
}

export function BuildWithAi() {
  return (
    <>
      <Lead>These docs are written to be read by AI as well as people, so an assistant can write your integration for you.</Lead>
      <H2>llms.txt</H2>
      <List items={[
        <><Code>{`https://${HOST}/llms.txt`}</Code>: a short index of every docs page, for AI tools that read the web.</>,
        <><Code>{`https://${HOST}/llms-full.txt`}</Code>: every page in one file of Markdown. Paste it into a chat, or point your tool at it.</>,
      ]} />
      <H2>Copy a page for AI</H2>
      <P>Every page here has a <B>Copy for AI</B> button at the top. It copies the page as Markdown, with its address, ready to paste into Claude, ChatGPT or Cursor.</P>
      <H2>The OpenAPI spec</H2>
      <P>The whole API as one machine-readable file, the same file the SDKs and this reference are made from:</P>
      <Sample samples={{ bash: `
curl ${API}/openapi.json -o aftercall-openapi.json` }} />
      <P>Give it to an AI to write a client in any language, or import it into Postman or Insomnia.</P>
      <H2>Function definitions</H2>
      <P>If you’re building your own agent, the API’s actions come ready as tool definitions for the Claude and OpenAI APIs:</P>
      <Sample samples={{ bash: `
curl ${API}/tools.json?format=anthropic   # or format=openai` }} />
      <Note kind="tip">Most assistants do better with the <A to="/docs/api/mcp">MCP server</A>: they call aftercall directly instead of writing code for it.</Note>
    </>
  )
}
