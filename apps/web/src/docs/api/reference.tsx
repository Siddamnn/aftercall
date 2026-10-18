// API reference: every endpoint, with its parameters, a request in each language and a response.
// Two columns on wide screens (the words on the left, the code beside them), as Stripe does. This is
// the shape the backend builds to (B59 to B61); once the OpenAPI spec exists, these pages are
// checked against it.
import type { ReactNode } from 'react'
import { HOST } from '../../config'
import { A, B, Code, H2, Lead, List, Note, P, Table } from '../kit'
import { API, VERSION } from './guides'
import { Fields, MethodTag, Route, Sample, type Field, type Lang, type Method } from './kit'

const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** One endpoint: its heading (listed in "On this page"), then the words beside the code. */
function Endpoint({ title, method, path, children, request, response }: { title: string; method: Method; path: string; children: ReactNode; request: Partial<Record<Lang, string>>; response: string }) {
  return (
    <section className="border-t pt-10 first-of-type:border-0 first-of-type:pt-0">
      <H2>{title}</H2>
      <div className="grid gap-x-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Route method={method} path={path} />
          {children}
        </div>
        <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
          <Sample title={`${method} ${path}`} samples={request} className="xl:mt-4" />
          <Sample title="Response" samples={{ json: response }} />
        </div>
      </div>
    </section>
  )
}

/** The endpoints on this page, at the top, like an index. */
function Index({ items }: { items: [Method, string, string][] }) {
  return (
    <ul className="my-6 divide-y rounded-xl border bg-card font-mono text-sm shadow-panel">
      {items.map(([m, p, t]) => (
        <li key={t}>
          <a href={`#${id(t)}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50">
            <MethodTag method={m} className="w-14 justify-center" />
            <span className="min-w-0 truncate">{p}</span>
            <span className="ml-auto hidden font-sans text-xs text-muted-foreground sm:block">{t}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

const auth = (s: string) => s.replace('AUTH', '-H "Authorization: Bearer $AFTERCALL_KEY"')

// ── Objects ───────────────────────────────────────────────────────────────────

const conversationFields: Field[] = [
  { name: 'id', type: 'string', desc: <>Starts <Code>conv_</Code>.</> },
  { name: 'object', type: 'string', desc: <>Always <Code>conversation</Code>.</> },
  { name: 'project', type: 'string', desc: 'The project’s slug.' },
  { name: 'external_id', type: 'string | null', desc: 'Your id for it.' },
  { name: 'channel', type: 'string', desc: <><Code>call</Code>, <Code>chat</Code>, <Code>voice_agent</Code>, <Code>email</Code> or your own.</> },
  { name: 'status', type: 'enum', desc: <>See <A to="/docs/api/push-conversations#statuses">statuses</A>.</> },
  { name: 'started_at', type: 'timestamp | null', desc: 'When it started (ISO 8601).' },
  { name: 'duration_seconds', type: 'integer | null', desc: 'How long it lasted.' },
  { name: 'metadata', type: 'object', desc: 'Your keys and values.' },
  { name: 'transcript', type: 'array', desc: <>Turns, as read. Only with <Code>conversations:read</Code>.</> },
  { name: 'results', type: 'array', desc: <>Answers, once <Code>analyzed</Code>. <A to="/docs/api/reading-results#a-result">A result</A></> },
  { name: 'usage', type: 'object', desc: <><Code>tokens</Code> used and <Code>cost_usd</Code> charged.</> },
  { name: 'failure', type: 'object | null', desc: <>When <Code>failed</Code>: <Code>code</Code> and <Code>message</Code>.</> },
  { name: 'created_at', type: 'timestamp', desc: 'When aftercall received it.' },
  { name: 'livemode', type: 'boolean', desc: 'False in test mode.' },
]

// ── Pages ─────────────────────────────────────────────────────────────────────

export function RefConversations() {
  return (
    <>
      <Lead>A conversation is one call, chat or thread: its transcript, your metadata, and once analysed, its answers.</Lead>
      <Index items={[
        ['POST', '/v1/conversations', 'Create a conversation'],
        ['POST', '/v1/conversations/batch', 'Create many'],
        ['GET', '/v1/conversations/{id}', 'Get a conversation'],
        ['GET', '/v1/conversations', 'List conversations'],
        ['DELETE', '/v1/conversations/{id}', 'Delete a conversation'],
      ]} />
      <H2>The conversation object</H2>
      <Fields items={conversationFields} />

      <Endpoint title="Create a conversation" method="POST" path="/v1/conversations"
        request={{
          curl: auth(`
curl ${API}/conversations \\
  AUTH \\
  -H "Idempotency-Key: CA8f2e91c4" \\
  -d project=front-desk \\
  -d external_id=CA8f2e91c4 \\
  -d channel=call \\
  --data-urlencode "transcript=Agent: Hello…"`),
          python: `
client.conversations.create(
    project="front-desk",
    external_id="CA8f2e91c4",
    channel="call",
    transcript="Agent: Hello…",
)`,
          node: `
await client.conversations.create({
  project: 'front-desk',
  external_id: 'CA8f2e91c4',
  channel: 'call',
  transcript: 'Agent: Hello…',
})`,
        }}
        response={`
{
  "id": "conv_01J9ZK4T6Q",
  "object": "conversation",
  "status": "queued",
  "duplicate": false,
  "estimate": { "tokens": 2143, "cost_usd": 0.0011 }
}`}
      >
        <P>Stores a conversation and, by the project’s <A to="/docs/api/auto-run">auto-run rule</A>, analyses it. Returns <Code>202</Code> at once. Needs <Code>conversations:write</Code>.</P>
        <Fields title="Body" items={[
          { name: 'project', type: 'string', required: true, desc: 'The project’s slug or id. Not needed when the key is limited to one project.' },
          { name: 'transcript', type: 'array | string | object', required: true, desc: <>Turns, plain text, or your platform’s format. <A to="/docs/api/conversation-format">Formats</A></> },
          { name: 'external_id', type: 'string', desc: 'Your id. A second conversation with the same one in the project isn’t stored again.' },
          { name: 'format', type: 'string', desc: <>The transcript’s format, like <Code>vapi</Code>, when it’s a platform’s own.</> },
          { name: 'channel', type: 'string', desc: <>Default <Code>call</Code>.</> },
          { name: 'started_at', type: 'timestamp', desc: 'When it started. Default: now.' },
          { name: 'duration_seconds', type: 'integer', desc: 'How long it lasted.' },
          { name: 'metadata', type: 'object', desc: 'Up to 50 string keys and values, for filtering in Insights.' },
          {
            name: 'run', type: 'string | object', desc: <>What to run. Default <Code>project_default</Code>.</>,
            children: [
              { name: 'trackers', type: 'string[]', desc: 'Tracker keys to run instead of the rule’s.' },
              { name: 'none', type: '"none"', desc: <>Pass <Code>{'"run": "none"'}</Code> to store only.</> },
            ],
          },
        ]} />
      </Endpoint>

      <Endpoint title="Create many" method="POST" path="/v1/conversations/batch"
        request={{
          curl: auth(`
curl ${API}/conversations/batch \\
  AUTH \\
  -H "Content-Type: application/json" \\
  -d '{"project": "front-desk", "conversations": [{"external_id": "CA01", "transcript": "…"}]}'`),
          python: `client.conversations.batch(project="front-desk", conversations=calls)`,
          node: `await client.conversations.batch({ project: 'front-desk', conversations: calls })`,
        }}
        response={`
{
  "object": "batch",
  "accepted": 498,
  "duplicates": 1,
  "rejected": [ { "index": 37, "error": { "code": "transcript_empty" } } ],
  "estimate": { "tokens": 1048211, "cost_usd": 0.52 }
}`}
      >
        <P>Up to 500 conversations, each with the same fields as one. Items that fail are listed in <Code>rejected</Code>; the rest are stored.</P>
        <Fields title="Body" items={[
          { name: 'project', type: 'string', required: true, desc: 'Applies to every item.' },
          { name: 'conversations', type: 'array', required: true, desc: '1 to 500 conversations.' },
          { name: 'run', type: 'string | object', desc: 'Applies to every item that doesn’t set its own.' },
        ]} />
      </Endpoint>

      <Endpoint title="Get a conversation" method="GET" path="/v1/conversations/{id}"
        request={{
          curl: auth(`
curl ${API}/conversations/conv_01J9ZK4T6Q \\
  AUTH`),
          python: `client.conversations.retrieve("conv_01J9ZK4T6Q")`,
          node: `await client.conversations.retrieve('conv_01J9ZK4T6Q')`,
        }}
        response={`
{
  "id": "conv_01J9ZK4T6Q",
  "object": "conversation",
  "status": "analyzed",
  "external_id": "CA8f2e91c4",
  "channel": "call",
  "metadata": { "agent_version": "v2.3" },
  "results": [
    { "signal": "call_reason", "answer": "reschedule", "confidence": 0.94, "needs_review": false }
  ],
  "usage": { "tokens": 2098, "cost_usd": 0.0010 }
}`}
      >
        <P>Needs <Code>results:read</Code>; add <Code>conversations:read</Code> to get the transcript.</P>
        <Fields title="Query" items={[
          { name: 'include', type: 'string[]', desc: <><Code>transcript</Code>, <Code>evidence</Code>. Left out by default to keep responses small.</> },
        ]} />
      </Endpoint>

      <Endpoint title="List conversations" method="GET" path="/v1/conversations"
        request={{
          curl: auth(`
curl "${API}/conversations?project=front-desk&status=analyzed&limit=20" \\
  AUTH`),
          python: `client.conversations.list(project="front-desk", status="analyzed")`,
          node: `client.conversations.list({ project: 'front-desk', status: 'analyzed' })`,
        }}
        response={`
{
  "object": "list",
  "data": [ { "id": "conv_01J9ZK4T6Q", "object": "conversation", "status": "analyzed" } ],
  "has_more": true,
  "next_cursor": "conv_01J9ZK4T6Q"
}`}
      >
        <P>Newest first. <A to="/docs/api/pagination">Paginated</A>.</P>
        <Fields title="Query" items={[
          { name: 'project', type: 'string', desc: 'Only this project.' },
          { name: 'external_id', type: 'string', desc: 'Find by your id.' },
          { name: 'status', type: 'enum', desc: 'Only this status.' },
          { name: 'channel', type: 'string', desc: 'Only this channel.' },
          { name: 'needs_review', type: 'boolean', desc: 'Only those with an answer that needs review.' },
          { name: 'created_after', type: 'timestamp', desc: 'Received after this time.' },
          { name: 'metadata[key]', type: 'string', desc: <>By metadata, like <Code>metadata[team]=front-desk</Code>.</> },
          { name: 'limit, starting_after', type: '', desc: 'Pagination.' },
        ]} />
      </Endpoint>

      <Endpoint title="Delete a conversation" method="DELETE" path="/v1/conversations/{id}"
        request={{
          curl: auth(`
curl -X DELETE ${API}/conversations/conv_01J9ZK4T6Q \\
  AUTH`),
          python: `client.conversations.delete("conv_01J9ZK4T6Q")`,
          node: `await client.conversations.delete('conv_01J9ZK4T6Q')`,
        }}
        response={`
{ "id": "conv_01J9ZK4T6Q", "object": "conversation", "deleted": true }`}
      >
        <P>Deletes the conversation, its transcript and its answers, everywhere, at once. It can’t be undone. Charges already made stay. Needs <Code>conversations:write</Code>.</P>
      </Endpoint>
    </>
  )
}

export function RefResults() {
  return (
    <>
      <Lead>Every answer, across conversations. Use it to sync results into a warehouse or report.</Lead>
      <Endpoint title="List results" method="GET" path="/v1/results"
        request={{
          curl: auth(`
curl "${API}/results?project=front-desk&since=2026-09-01T00:00:00Z&limit=100" \\
  AUTH`),
          python: `client.results.list(project="front-desk", since="2026-09-01T00:00:00Z")`,
          node: `client.results.list({ project: 'front-desk', since: '2026-09-01T00:00:00Z' })`,
        }}
        response={`
{
  "object": "list",
  "data": [
    {
      "id": "res_01J9ZM0A8C",
      "object": "result",
      "conversation": "conv_01J9ZK4T6Q",
      "external_id": "CA8f2e91c4",
      "tracker": "booking",
      "signal": "call_reason",
      "type": "pick_one",
      "answer": "reschedule",
      "confidence": 0.94,
      "needs_review": false,
      "reviewed": null,
      "updated_at": "2026-09-27T10:18:03Z"
    }
  ],
  "has_more": false,
  "next_cursor": "res_01J9ZM0A8C"
}`}
      >
        <P><B>Oldest first</B>, by when the answer last changed, so a sync can carry on from its last cursor and also pick up corrections. Needs <Code>results:read</Code>.</P>
        <Fields title="Query" items={[
          { name: 'project', type: 'string', required: true, desc: 'The project.' },
          { name: 'since', type: 'timestamp', desc: 'Changed at or after this time.' },
          { name: 'tracker', type: 'string', desc: 'Only this tracker.' },
          { name: 'signal', type: 'string', desc: 'Only this signal.' },
          { name: 'needs_review', type: 'boolean', desc: 'Only answers that need review.' },
          { name: 'limit, starting_after', type: '', desc: 'Pagination.' },
        ]} />
      </Endpoint>
    </>
  )
}

export function RefUploads() {
  return (
    <>
      <Lead>An upload is one file of conversations, read the same way as in the app. <A to="/docs/api/uploads">Large files and backfills</A></Lead>
      <Index items={[
        ['POST', '/v1/uploads', 'Create an upload'],
        ['GET', '/v1/uploads/{id}', 'Get an upload'],
      ]} />
      <Endpoint title="Create an upload" method="POST" path="/v1/uploads"
        request={{
          curl: auth(`
curl ${API}/uploads \\
  AUTH \\
  -d project=front-desk \\
  -d filename=calls-2025.jsonl \\
  -d run=on_read`),
          python: `client.uploads.create(project="front-desk", file=open("calls-2025.jsonl", "rb"), run="on_read")`,
          node: `await client.uploads.create({ project: 'front-desk', file: fs.createReadStream('calls-2025.jsonl'), run: 'on_read' })`,
        }}
        response={`
{
  "id": "upl_01J9ZP3H6N",
  "object": "upload",
  "status": "awaiting_file",
  "upload_url": "https://storage.${HOST}/…",
  "upload_url_expires_at": "2026-09-27T11:15:00Z"
}`}
      >
        <P>Returns a URL to <Code>PUT</Code> the file to, valid for an hour. The SDKs do both steps.</P>
        <Fields title="Body" items={[
          { name: 'project', type: 'string', required: true, desc: 'The project.' },
          { name: 'filename', type: 'string', required: true, desc: 'The file’s name, with its extension.' },
          { name: 'run', type: 'enum', desc: <><Code>on_read</Code> runs as soon as it’s read. <Code>manual</Code> (the default) waits for a <A to="/docs/api/reference-runs">run</A>.</> },
          { name: 'trackers', type: 'string[]', desc: 'For on_read: which trackers. Default: the auto-run rule’s.' },
        ]} />
      </Endpoint>
      <Endpoint title="Get an upload" method="GET" path="/v1/uploads/{id}"
        request={{
          curl: auth(`
curl ${API}/uploads/upl_01J9ZP3H6N \\
  AUTH`),
          python: `client.uploads.retrieve("upl_01J9ZP3H6N")`,
          node: `await client.uploads.retrieve('upl_01J9ZP3H6N')`,
        }}
        response={`
{
  "id": "upl_01J9ZP3H6N",
  "object": "upload",
  "status": "read",
  "found": 12480,
  "skipped": [ { "row": 88, "reason": "No transcript" } ],
  "too_large": 3,
  "format": "jsonl",
  "estimate": { "tokens": 26208000, "cost_usd": 13.10 }
}`}
      >
        <P>Status goes <Code>awaiting_file</Code> → <Code>reading</Code> → <Code>read</Code> (or <Code>failed</Code>), then <Code>running</Code> and <Code>done</Code> once run.</P>
      </Endpoint>
    </>
  )
}

export function RefRuns() {
  return (
    <>
      <Lead>A run analyses conversations you’ve already sent, with trackers you choose: a new tracker over last month’s calls, or an upload you checked first.</Lead>
      <Index items={[
        ['POST', '/v1/runs', 'Start a run'],
        ['GET', '/v1/runs/{id}', 'Get a run'],
      ]} />
      <Endpoint title="Start a run" method="POST" path="/v1/runs"
        request={{
          curl: auth(`
curl ${API}/runs \\
  AUTH \\
  -H "Content-Type: application/json" \\
  -d '{"project": "front-desk", "trackers": ["compliance"], "conversations": {"created_after": "2026-09-01T00:00:00Z"}}'`),
          python: `client.runs.create(project="front-desk", trackers=["compliance"], conversations={"created_after": "2026-09-01T00:00:00Z"})`,
          node: `await client.runs.create({ project: 'front-desk', trackers: ['compliance'], conversations: { created_after: '2026-09-01T00:00:00Z' } })`,
        }}
        response={`
{
  "id": "run_01J9ZQ5D2F",
  "object": "run",
  "status": "running",
  "conversations": 3120,
  "estimate": { "tokens": 4402000, "cost_usd": 2.20 },
  "hold_usd": 2.20
}`}
      >
        <P>Holds the estimate from credits, like the app. If credits can’t cover it, returns <Code>402</Code> <Code>insufficient_credits</Code> and nothing runs. Needs <Code>runs:write</Code>.</P>
        <Fields title="Body" items={[
          { name: 'project', type: 'string', required: true, desc: 'The project.' },
          { name: 'trackers', type: 'string[]', required: true, desc: 'Tracker keys to run.' },
          {
            name: 'conversations', type: 'object', required: true, desc: 'Which conversations. One of:',
            children: [
              { name: 'upload', type: 'string', desc: 'Every conversation in this upload.' },
              { name: 'ids', type: 'string[]', desc: 'Up to 1,000 conversation ids.' },
              { name: 'created_after, created_before', type: 'timestamp', desc: 'A date range.' },
            ],
          },
          { name: 'dry_run', type: 'boolean', desc: 'Only return the count and estimate.' },
        ]} />
      </Endpoint>
      <Endpoint title="Get a run" method="GET" path="/v1/runs/{id}"
        request={{
          curl: auth(`
curl ${API}/runs/run_01J9ZQ5D2F \\
  AUTH`),
          python: `client.runs.retrieve("run_01J9ZQ5D2F")`,
          node: `await client.runs.retrieve('run_01J9ZQ5D2F')`,
        }}
        response={`
{
  "id": "run_01J9ZQ5D2F",
  "object": "run",
  "status": "completed",
  "done": 3117,
  "failed": 3,
  "usage": { "tokens": 4318822, "cost_usd": 2.16 }
}`}
      >
        <P><Code>run.completed</Code> fires when it finishes.</P>
      </Endpoint>
    </>
  )
}

export function RefTrackers() {
  return (
    <>
      <Lead>Trackers group the questions (signals) asked of every conversation. Read them to label answers; create them to set up projects from code.</Lead>
      <Index items={[
        ['GET', '/v1/trackers', 'List trackers'],
        ['POST', '/v1/trackers', 'Create a tracker'],
        ['PATCH', '/v1/trackers/{key}', 'Update a tracker'],
      ]} />
      <Endpoint title="List trackers" method="GET" path="/v1/trackers"
        request={{
          curl: auth(`
curl "${API}/trackers?project=front-desk" \\
  AUTH`),
          python: `client.trackers.list(project="front-desk")`,
          node: `await client.trackers.list({ project: 'front-desk' })`,
        }}
        response={`
{
  "object": "list",
  "data": [
    {
      "key": "booking",
      "object": "tracker",
      "name": "Booking",
      "active": true,
      "signals": [
        {
          "key": "call_reason",
          "question": "Why did the customer call?",
          "type": "pick_one",
          "options": [
            { "key": "reschedule", "label": "Reschedule" },
            { "key": "new_booking", "label": "New booking" },
            { "key": "other", "label": "Other" }
          ]
        }
      ]
    }
  ]
}`}
      >
        <P>Every tracker in the project with its signals. Needs <Code>trackers:read</Code>.</P>
      </Endpoint>
      <Endpoint title="Create a tracker" method="POST" path="/v1/trackers"
        request={{
          curl: auth(`
curl ${API}/trackers \\
  AUTH \\
  -H "Content-Type: application/json" \\
  -d @tracker.json`),
          python: `client.trackers.create(project="front-desk", **json.load(open("tracker.json")))`,
          node: `await client.trackers.create({ project: 'front-desk', ...tracker })`,
        }}
        response={`
{ "key": "compliance", "object": "tracker", "name": "Compliance", "active": false, "signals": [ … ] }`}
      >
        <P>Takes the same JSON as <A to="/docs/import-trackers">importing trackers</A> in the app. New trackers start switched off, so nothing runs until someone turns them on. Needs <Code>trackers:write</Code>.</P>
      </Endpoint>
      <Endpoint title="Update a tracker" method="PATCH" path="/v1/trackers/{key}"
        request={{
          curl: auth(`
curl -X PATCH ${API}/trackers/compliance \\
  AUTH \\
  -d project=front-desk \\
  -d active=true`),
          python: `client.trackers.update("compliance", project="front-desk", active=True)`,
          node: `await client.trackers.update('compliance', { project: 'front-desk', active: true })`,
        }}
        response={`
{ "key": "compliance", "object": "tracker", "active": true }`}
      >
        <P>Change the name, turn it on or off, or replace its signals. Changing a signal’s question applies to conversations analysed from then on.</P>
      </Endpoint>
    </>
  )
}

export function RefProjects() {
  return (
    <>
      <Lead>Projects are the use cases in a workspace. A key sees the projects it’s allowed.</Lead>
      <Endpoint title="List projects" method="GET" path="/v1/projects"
        request={{
          curl: auth(`
curl ${API}/projects \\
  AUTH`),
          python: `client.projects.list()`,
          node: `await client.projects.list()`,
        }}
        response={`
{
  "object": "list",
  "data": [
    {
      "id": "prj_01J9Z8Y2K1",
      "object": "project",
      "slug": "front-desk",
      "name": "Front desk calls",
      "review_line": 0.7,
      "auto_run": { "mode": "project_default", "daily_cap_usd": 20.0 }
    }
  ]
}`}
      >
        <P>Use the <Code>slug</Code> or <Code>id</Code> wherever a request takes <Code>project</Code>. Projects are created in the app.</P>
      </Endpoint>
    </>
  )
}

export function RefInsights() {
  return (
    <>
      <Lead>The numbers behind Insights: how a signal’s answers split, over time, and by metadata.</Lead>
      <Endpoint title="Get a signal’s insights" method="GET" path="/v1/insights"
        request={{
          curl: auth(`
curl "${API}/insights?project=front-desk&signal=call_reason&from=2026-09-01&to=2026-09-27&interval=week&group_by=metadata.agent_version" \\
  AUTH`),
          python: `client.insights.retrieve(project="front-desk", signal="call_reason", interval="week", group_by="metadata.agent_version")`,
          node: `await client.insights.retrieve({ project: 'front-desk', signal: 'call_reason', interval: 'week', group_by: 'metadata.agent_version' })`,
        }}
        response={`
{
  "object": "insight",
  "signal": "call_reason",
  "total": 3120,
  "series": [
    {
      "group": "v2.3",
      "points": [
        { "period": "2026-09-01", "count": 402, "answers": { "reschedule": 181, "new_booking": 150, "other": 71 } }
      ]
    }
  ]
}`}
      >
        <P>Needs <Code>results:read</Code>.</P>
        <Fields title="Query" items={[
          { name: 'project', type: 'string', required: true, desc: 'The project.' },
          { name: 'signal', type: 'string', required: true, desc: 'The signal’s key.' },
          { name: 'from, to', type: 'date', desc: 'The range. Default: the last 30 days.' },
          { name: 'interval', type: 'enum', desc: <><Code>day</Code>, <Code>week</Code> or <Code>month</Code>.</> },
          { name: 'group_by', type: 'string', desc: <><Code>channel</Code>, or a metadata key like <Code>metadata.team</Code>.</> },
        ]} />
      </Endpoint>
    </>
  )
}

export function RefWebhookEndpoints() {
  return (
    <>
      <Lead>Where events are sent. <A to="/docs/api/webhooks">Webhooks</A> explains delivery and retries.</Lead>
      <Index items={[
        ['POST', '/v1/webhook_endpoints', 'Create an endpoint'],
        ['GET', '/v1/webhook_endpoints', 'List endpoints'],
        ['PATCH', '/v1/webhook_endpoints/{id}', 'Update an endpoint'],
        ['DELETE', '/v1/webhook_endpoints/{id}', 'Delete an endpoint'],
      ]} />
      <Endpoint title="Create an endpoint" method="POST" path="/v1/webhook_endpoints"
        request={{
          curl: auth(`
curl ${API}/webhook_endpoints \\
  AUTH \\
  -d url=https://example.com/aftercall/webhook \\
  -d "events[]=conversation.analyzed"`),
          python: `client.webhook_endpoints.create(url="https://example.com/aftercall/webhook", events=["conversation.analyzed"])`,
          node: `await client.webhookEndpoints.create({ url: 'https://example.com/aftercall/webhook', events: ['conversation.analyzed'] })`,
        }}
        response={`
{
  "id": "we_01J9ZS8K4M",
  "object": "webhook_endpoint",
  "url": "https://example.com/aftercall/webhook",
  "events": ["conversation.analyzed"],
  "project": null,
  "api_version": "${VERSION}",
  "status": "enabled",
  "secret": "whsec_5WbX5kEWLlfzsGNjH64I8lOOqUB6e8FH"
}`}
      >
        <P>The <Code>secret</Code> is only in this response. Needs <Code>webhooks:write</Code>.</P>
        <Fields title="Body" items={[
          { name: 'url', type: 'string', required: true, desc: 'HTTPS only.' },
          { name: 'events', type: 'string[]', required: true, desc: <>Event types, or <Code>["*"]</Code> for all. <A to="/docs/api/webhook-events">Event types</A></> },
          { name: 'project', type: 'string', desc: 'Only events from this project.' },
          { name: 'description', type: 'string', desc: 'For your own notes.' },
        ]} />
      </Endpoint>
      <Endpoint title="List endpoints" method="GET" path="/v1/webhook_endpoints"
        request={{ curl: auth(`\ncurl ${API}/webhook_endpoints \\\n  AUTH`), python: `client.webhook_endpoints.list()`, node: `await client.webhookEndpoints.list()` }}
        response={`
{ "object": "list", "data": [ { "id": "we_01J9ZS8K4M", "object": "webhook_endpoint", "status": "enabled" } ], "has_more": false }`}
      >
        <P>Secrets aren’t included.</P>
      </Endpoint>
      <Endpoint title="Update an endpoint" method="PATCH" path="/v1/webhook_endpoints/{id}"
        request={{ curl: auth(`\ncurl -X PATCH ${API}/webhook_endpoints/we_01J9ZS8K4M \\\n  AUTH \\\n  -d status=disabled`), python: `client.webhook_endpoints.update("we_01J9ZS8K4M", status="disabled")`, node: `await client.webhookEndpoints.update('we_01J9ZS8K4M', { status: 'disabled' })` }}
        response={`
{ "id": "we_01J9ZS8K4M", "object": "webhook_endpoint", "status": "disabled" }`}
      >
        <P>Change <Code>url</Code>, <Code>events</Code>, <Code>project</Code>, or <Code>status</Code> (<Code>enabled</Code>/<Code>disabled</Code>). Re-enabling sends nothing missed; use <A to="/docs/api/reference-events">events</A> to catch up.</P>
      </Endpoint>
      <Endpoint title="Delete an endpoint" method="DELETE" path="/v1/webhook_endpoints/{id}"
        request={{ curl: auth(`\ncurl -X DELETE ${API}/webhook_endpoints/we_01J9ZS8K4M \\\n  AUTH`), python: `client.webhook_endpoints.delete("we_01J9ZS8K4M")`, node: `await client.webhookEndpoints.delete('we_01J9ZS8K4M')` }}
        response={`
{ "id": "we_01J9ZS8K4M", "object": "webhook_endpoint", "deleted": true }`}
      >
        <P>Stops deliveries at once.</P>
      </Endpoint>
    </>
  )
}

export function RefEvents() {
  return (
    <>
      <Lead>Every event is kept for 30 days, whether or not it was delivered. List them to catch up after downtime.</Lead>
      <Index items={[
        ['GET', '/v1/events', 'List events'],
        ['GET', '/v1/events/{id}', 'Get an event'],
      ]} />
      <Endpoint title="List events" method="GET" path="/v1/events"
        request={{
          curl: auth(`
curl "${API}/events?type=conversation.analyzed&created_after=1759100000" \\
  AUTH`),
          python: `client.events.list(type="conversation.analyzed", created_after=1759100000)`,
          node: `client.events.list({ type: 'conversation.analyzed', created_after: 1759100000 })`,
        }}
        response={`
{
  "object": "list",
  "data": [ { "id": "evt_01J9ZM2B7R", "object": "event", "type": "conversation.analyzed", "created": 1759140930 } ],
  "has_more": true,
  "next_cursor": "evt_01J9ZM2B7R"
}`}
      >
        <Fields title="Query" items={[
          { name: 'type', type: 'string', desc: <>One type, or a prefix like <Code>conversation.*</Code>.</> },
          { name: 'created_after', type: 'unix seconds', desc: 'Only newer events.' },
          { name: 'delivery_failed', type: 'boolean', desc: 'Only events an endpoint didn’t accept.' },
          { name: 'limit, starting_after', type: '', desc: 'Pagination.' },
        ]} />
      </Endpoint>
      <Endpoint title="Get an event" method="GET" path="/v1/events/{id}"
        request={{ curl: auth(`\ncurl ${API}/events/evt_01J9ZM2B7R \\\n  AUTH`), python: `client.events.retrieve("evt_01J9ZM2B7R")`, node: `await client.events.retrieve('evt_01J9ZM2B7R')` }}
        response={`
{ "id": "evt_01J9ZM2B7R", "object": "event", "type": "conversation.analyzed", "data": { "object": { … } }, "deliveries": [ { "endpoint": "we_01J9ZS8K4M", "status": 200, "at": 1759140931 } ] }`}
      >
        <P>Includes each delivery attempt and its response code.</P>
      </Endpoint>
    </>
  )
}

export function Sdks() {
  return (
    <>
      <Lead>Official libraries for Python and TypeScript. They’re made from the same OpenAPI spec as this reference, so they always match the API, and they handle retries, pagination and webhook signatures for you.</Lead>
      <H2>Python</H2>
      <Sample samples={{ bash: `pip install aftercall` }} />
      <Sample samples={{ python: `
from aftercall import Aftercall

client = Aftercall()  # reads AFTERCALL_KEY from the environment
for project in client.projects.list():
    print(project.slug)` }} />
      <P>Python 3.9 and newer. Sync and async (<Code>AsyncAftercall</Code>) clients, typed with Pydantic models.</P>
      <H2>TypeScript and JavaScript</H2>
      <Sample samples={{ bash: `npm install aftercall` }} />
      <Sample samples={{ node: `
import Aftercall from 'aftercall'

const client = new Aftercall() // reads AFTERCALL_KEY from the environment
for await (const project of client.projects.list()) console.log(project.slug)` }} />
      <P>Node 18 and newer, Deno, Bun, and edge runtimes like Cloudflare Workers. Fully typed.</P>
      <H2>What they do for you</H2>
      <List items={[
        'Retries on network errors, 429 and 5xx, with backoff and the same idempotency key.',
        <>Idempotency keys on every <Code>POST</Code>, made for you unless you set one.</>,
        'Pagination: loop over a list and pages are fetched as needed.',
        <>Webhooks: <Code>client.webhooks.verify(body, header, secret)</Code> checks the signature and returns the typed event.</>,
        'Uploads: one call sends the file to storage and returns the upload.',
      ]} />
      <H2>Other languages</H2>
      <P>Use the API directly, or generate a client from the <A to="/docs/api/build-with-ai#the-openapi-spec">OpenAPI spec</A>. Go and PHP samples for webhooks are in <A to="/docs/api/verify-webhooks">Verify signatures</A>.</P>
      <H2>The CLI</H2>
      <Sample samples={{ bash: `
brew install aftercall/tap/aftercall   # or: npm install -g @aftercall/cli
aftercall login
aftercall conversations create --project front-desk --file call.json
aftercall listen --forward-to localhost:3000/webhook` }} />
    </>
  )
}

export function ApiChangelog() {
  return (
    <>
      <Lead>Every change to the API. Breaking changes only come with a new dated version; everything else can arrive any day. <A to="/docs/api/versioning">Versioning</A></Lead>
      <H2 anchor={VERSION}>{`${VERSION} · preview`}</H2>
      <P>The first version of the API, in design. What’s here is what we’re building:</P>
      <List items={[
        'Conversations: create, create many, get, list, delete.',
        'Uploads, runs, results, trackers, projects and insights.',
        'Webhook endpoints and events, signed with HMAC-SHA256.',
        'Live and test keys with scopes.',
        'The MCP server for AI tools.',
      ]} />
      <Note>Want to be told when it opens, or to try it early? Email <A to={`mailto:hello@${HOST}`}>{`hello@${HOST}`}</A>.</Note>
      <H2>How changes are listed</H2>
      <Table head={['Label', 'Means']} rows={[
        [<B>New</B>, 'An endpoint, field, event or parameter was added. Nothing to do.'],
        [<B>Changed</B>, 'Behaviour changed in a way that doesn’t break code written for the version.'],
        [<B>Breaking</B>, 'Only in a new version. It says what to change.'],
        [<B>Deprecated</B>, 'Still works, and will be removed in a later version.'],
      ]} />
    </>
  )
}
