# Models on Firestore

Source of truth: `apps/backend/aftercall/models.py`. Every record is a `Doc` subclass (`store.py`); `collection` is the old table name.
All ids are `str`. Random ids are `<prefix>-<12 hex>` and default on construction (`Tracker(tenant_id=..., ...)` has an id already).
Records marked **keyed** compute a deterministic id from their key fields when you leave `id` out (`Cls.make_id(*parts)` does the same by hand).
No relationships: join in Python. Timestamps are tz-aware UTC. Nothing sets `updated_at` for you.

## Ids and ordering

- Every API id is a string. Nothing orders by id any more: order by `created_at`; where two docs can share a timestamp use the integer
  `seq` (Call.seq = row index in its upload, ThreadMessage.seq = message index, Tracker.seq / Signal.seq = creation order). Callers set `seq`.
- `SignalVersion.version_number` (1, 2, 3 per signal) mirrors `version`, for display.

## Denormalised fields

Callers keep these in step when they write the source. Defaults are empty, so unported code still validates.
- Signal: `project_id`, `tracker_name`, `tracker_active`, `tracker_seq`, `seq`, `active_version`, `active_spec` (`Signal.activate(version)`).
  SignalVersion: `tenant_id`, `project_id`, `tracker_name`, `signal_name` (optional; fill on create).
- Tracker: `condition_tracker`, `condition_signal` (from `run_if`), `seq`. TrackerOverlap: `tracker_names`.
- Call: `latest_run_id`, `deleted`, `needs_review`, `needs_review_count`, `min_confidence`, `seq`, and the latest run itself:
  `latest_answers: list[AnswerView]` (every answer of the latest run, in the order made, with its review) and
  `latest_run: RunSummary` (`status`, `model`, `n_requests`, `tokens_input`, `tokens_output`, `conditions`). Insights, `GET /calls`,
  `/uploads/{id}/results`, exports of a scope and Ask alteria read these and never the Answer or Run docs. `latest.py` keeps them in step:
  `latest.apply` (the worker, when a run finishes), `latest.set_review` (review PUT/DELETE), `latest.drop` (erase), `latest.backfill`
  (`python -m aftercall.cli backfill-latest`, once, for calls analysed before the copies existed).
  Run: `tenant_id`, `project_id`, `upload_id`.
- Project: `data_version` (int, microseconds): `data_version.bump` after a call finishes, a review changes, calls are erased, or a tracker/signal is
  edited. Insights caches a scope's conversations for 30 s per (project, `data_version`, scope), so a bump is what makes a write show at once.
- Upload: `counts` per status. Project: `name_lower` (set automatically). AlteriaRequest: `is_draft`.
- Thread: `shared`, `pinned_by`, `message_count`, `last_question`, `owner_name`, `owner_avatar_url`.
- Not done: Member/Invite copies of user/tenant fields (read the User/Tenant by id), counter and rollup docs (usage_daily, spend, domains, slugs):
  aggregate in Python.

## Collections

| Collection (class) | Doc id | Notes |
|---|---|---|
| `tenants` (Tenant) | `w-…` | look up by `slug` or `api_key_hash` with `store.first`. `clerk_org_id` gone. `allowance_policy` kept but never enforced |
| `users` (User) | Firebase users: `u-<firebase uid>`; others `u-…` | `clerk_user_id` -> `firebase_uid`. Find by `email` / `firebase_uid` |
| `members` (Member, keyed) | `<tenant_id>:<user_id>` | no `user` relationship: `store.get(User, m.user_id)` |
| `invites` (Invite) | `i-…` | by `token` field. `clerk_invitation_id` gone. No `inviter`: get `invited_by` |
| `projects` (Project) | `p-…` | soft delete via `deleted_at` |
| `trackers` (Tracker) | `t-…` | name unique per project (check with `first(project_id, name)`); names never change. No `signals` list |
| `signals` (Signal) | `s-…` | copies `project_id`, `tracker_name`; and the active version as `active_version` + `active_spec`. Set with `signal.activate(version)` then `put` |
| `signal_versions` (SignalVersion, keyed) | `<signal_id>:<version>` | immutable. `Signal.active_version_id` points at one |
| `uploads` (Upload) | `up-…` | |
| `calls` (Call) | `c-…` | `meta` is the old `metadata` column. New: `audio_uri`, `audio_content_type`, `language`, `duration_seconds`. Unique `(project_id, source, external_id)` is checked by query, not by id |
| `runs` (Run) | `r-…` | kept (a retried call gets another run). Copies `tenant_id`, `project_id`, `upload_id`. The old `run_requests` table is `Run.requests: list[RunRequest]` (embedded, not a doc) |
| `answers` (Answer, keyed) | `<run_id>:<tracker_name>:<signal_name>` | see below |
| `usage_events` (UsageEvent) | `ue-…` | tokens only; `cost_micros` gone |
| `notifications` (Notification) | `n-…` | |
| `dashboards` (Dashboard) | `d-…` | |
| `threads` (Thread) | `th-…` | no `owner` / `messages` relationships |
| `thread_messages` (ThreadMessage) | `tm-…` | read a chat's messages `order_by="created_at"` |
| `thread_pins` (ThreadPin, keyed) | `<thread_id>:<user_id>` | |
| `doc_feedback` (DocFeedback) | `df-…` | |
| `audit_log` (AuditEntry) | `a-…` | |
| `alteria_requests` (AlteriaRequest) | `ar-…` | `cost_usd` is now the Gemini cost |
| `tracker_overlaps` (TrackerOverlap, keyed) | `<project_id>:<tracker_a>:<tracker_b>:<fp_a>:<fp_b>` | a cached overlap answer is one `get` |

Dropped: Account, LedgerEntry, CallCharge, Invoice, PricingVersion, Discount, Redemption, AdminToken, SignInSession, RunRequest-as-table.
Sign-in max hours needs no stored session: it is `auth_time` (Firebase's last sign-in) + `SESSION_MAX_HOURS`.

## Answer: history, and what the call carries

`AnswerView` holds an answer's value fields (`tracker_name`, `signal_name`, `signal_version` (the number), `type`, `value_text`, `value_num`,
`probabilities`, `confidence`, `needs_review`, `review_value`, `reviewed_by`, `reviewed_at`). `Answer` extends it with the run and the call fields
copied from the call by `Answer.for_call(call, run_id=..., tracker_name=..., ...)`: `project_id`, `tenant_id`, `upload_id`, `call_id`
(from `call.id`), `occurred_at`, `channel`, `agent_id`, `agent_version`, `meta`; and `signal_version_id` (nulled on a permanent signal delete).
Answer docs are the history: every run keeps its answers, and an answer counts when `answer.run_id == call.latest_run_id`.

Views never query Answers any more. The latest run's answers are copied onto the call as `Call.latest_answers` (no `signal_version_id`: nothing
reads it there, so a permanent signal delete leaves the copies alone). A review writes both: `store.update(Answer, Answer.make_id(call.latest_run_id,
tracker, signal), review_value=..., ...)` and the call's copy through `latest.set_review`, which recounts `needs_review_count` and writes only if
nobody else changed the call meanwhile (`claim` on `updated_at`, retried).
A scope's conversations are `results.find_calls(...)`: Call docs read without `transcript` (`store.find(..., select=[...])`).

## Helpers (call these)

- `workspaces.create(store, name, owner_user_or_None, slug=None, api_key=None) -> (Tenant, api_key)`: tenant + owner Member + default project.
- `workspaces.default_project(store, tenant) -> Project` (made on first use).
- `workspaces.by_api_key(store, key)`, `owner_of(store, tenant)`, `rotate_key(store, tenant) -> key`, `slug_free(store, slug, tenant_id=None)`, `free_slug(store, base)`.
- `workspaces.members_of(store, tenant_id) -> [Member]` (earliest first), `memberships_of(store, user_id)`, `seed_demo(store, api_key)`.
- `people.member_out(m, user)`, `invite_out(i, inviter)`, `users_by_id(store, ids)`, `me_out(store, user, tenant, role, expires)`,
  `open_invites(store, tenant_id)`, `create_invite(store, tenant, email, role, by)`, `renew_invite(store, invite)`, `revoke_invite(store, invite)`,
  `check_seat(store, tenant_id, role, why)`, `teammate_limit(store, tenant_id)`. Invites save only; nothing is emailed (share `people.invite_link`).
- `notify.send(store, tenant_id, kind, title, to_user_ids, body=, href=, actor_id=, project_id=)`, `notify.members_who_can(store, tenant_id, permission)`.
- `usage.record(store, tenant_id, kind, user_id=, project_id=, tokens=, ref=)`, `usage.count(store, tenant_id, kind)`,
  `usage.events(store, tenant_id, since, until=None, user_id=None)`. Routes group these in Python.
- Billing off, signatures kept with `store` for `session`: `billing.enabled()` False, `account(store, id)`, `quote(acc, tokens)` (zero money),
  `hold`/`settle` no-ops, `token_cost` None, `features(acc)` all True, `limits(acc, n)` all None, `plans()` unpriced, `NotEnoughCredits` never raised.
  `usage.check`/`notice_thresholds` no-ops, `allowance_micros` None, `spent_micros` 0. `pricing.current/display_currency/promotion` give billing-off shapes.
  `billing.Account` is a small dataclass, not a doc. `pricing.quote/redeem/save` are gone.
- `deps`: `StoreDep` replaces `SessionDep`; `Who`, `SignedInDep`, `MemberDep`, `require`, `ProjectDep`, `EngineDep`, `LLMDep` unchanged.
  `deps.user_for(store, firebase_session)` creates/links a user. `firebase_auth.verify(token) -> FirebaseSession` (tests monkeypatch it).
  Routes commit nothing now: write with `store.put/update`.
- `cli.create_tenant(name, owner_email=None, owner_name=None, store=None) -> NewTenant`, `cli.rotate_key(tenant_id, store=None)`.
- `api.py`: no worker thread; `StripApiPrefix` removes a leading `/api`; memory store + `DEV_API_KEY` seeds workspace "demo".

## Composite indexes

Equality-only filters (any number of fields) need none; ordering or a range on another field does.

Needed by my modules:
- `usage_events`: `tenant_id ASC, created_at DESC` (`usage.events`).

Indexes for the route queries (in `firestore.indexes.json`):
- `calls`: `project_id, status, occurred_at` (the insights scope: the only query of the Insights views, one read per call; the file has it
  ascending, which serves date ranges either way); `upload_id, created_at`; `status, created_at` (queue sweeps).
- `answers`: none. `project_id, occurred_at` was the old insights query and is gone; `call_id` and `signal_version_id` are equality only.
- `notifications`: `tenant_id, user_id, created_at DESC`.
- `thread_messages`: `thread_id, created_at`. `threads`: `project_id, updated_at DESC`.
- `runs`: `tenant_id, created_at`. `trackers`/`signals`: equality on `project_id` (+ `is_active`), sort in Python.
- `uploads`: `project_id, created_at DESC`. `dashboards`: `project_id, updated_at DESC`.
Firestore `in` takes at most 30 values: chunk id lists by 30, not 900.
