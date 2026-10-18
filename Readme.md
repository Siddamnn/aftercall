# aftercall — you keep your conversations, we handle the rest

Ask every conversation the same question. Transcript analysis for calls and chats (sales, support, collections, AI voice agents, WhatsApp and web chat), in depth and at scale, at a fraction of what an LLM costs. Not tied to any one call or chat tool. Group Choice / Yes-No / Score signals under your own parent trackers, upload transcripts or call recordings, choose which trackers to run, and every call is answered by TypeSafe Jev with confidence scores. Transcripts over 30k tokens are flagged and not run (long-call support comes later).

**Google Cloud AI Builder Cup 2026 build** (branch `google-cup`; billing is off in this build):

| Piece | Google Cloud |
|---|---|
| API | FastAPI on **Cloud Run** (asia-south1) |
| Records | **Firestore** (`apps/backend/aftercall/store.py`) |
| Per-call jobs | **Cloud Tasks** → `POST /tasks/run-call` |
| Recordings | **Cloud Storage**, transcribed with speakers by **Gemini** |
| Ask alteria | **Gemini** on Vertex AI; Jev picks the cheapest model tier that's enough |
| Sign-in | **Firebase Authentication** (Google) |
| Web | React on **Firebase Hosting**, `/api` rewritten to Cloud Run |
| Secrets | **Secret Manager** |
| Signals | **TypeSafe Jev** (unchanged) |

## Repo layout

```
aftercall/
├─ apps/
│  ├─ backend/        Python API (FastAPI, Firestore, Cloud Tasks, Gemini, Jev) — see apps/backend/README.md
│  └─ web/            React UI (Vite, Tailwind, Firebase Auth) — see apps/web/README.md
├─ samples/           shared sample calls, trackers + signals (tests, smoke test, demo)
├─ docs/              google-cup/deploy.md (deploy runbook)
├─ firebase.json      Hosting + Firestore rules and indexes
├─ deploy.sh          one-shot deploy to a GCP project (see docs/google-cup/deploy.md)
├─ .env.example       one env file for every app; copy to .env at the repo root
└─ .venv/             local virtualenv (git-ignored)
```

## Run locally (from the repo root)

```bash
./start.sh            # API on :8000 (in-memory store, demo workspace) + web UI on http://localhost:5173
./start.sh -dev       # web UI only, on its mock data
```

- **First run** creates `.venv`, installs what's missing, and generates `DEV_API_KEY` in `.env` (shared with the web's dev proxy as `AFTERCALL_API_KEY`).
- **Keys** in the root `.env`: `TYPESAFE_API_KEY` (Jev, required to analyse), `GEMINI_API_KEY` (Ask alteria and recordings; on Cloud Run Vertex AI is used instead).
- **Locally, records are in memory** and gone on restart. `STORE_BACKEND=firestore` with `GCP_PROJECT` uses a real Firestore.
- **Requests** need `X-API-Key: <key>` (acts as the workspace owner) or a Firebase ID token as `Authorization: Bearer`. API docs: http://127.0.0.1:8000/docs.

## Deploy

```bash
PROJECT=<gcp-project> ./deploy.sh --dry-run   # print the plan
PROJECT=<gcp-project> ./deploy.sh             # APIs, Firestore, bucket, queue, service accounts, secret, Cloud Run, Hosting
```

Prerequisites (gcloud, firebase CLI, Firebase web config, Google sign-in enabled) are in [docs/google-cup/deploy.md](docs/google-cup/deploy.md).

| Endpoint | Purpose |
|---|---|
| `POST /trackers`, `GET /trackers`, `GET/PUT/DELETE /trackers/{tracker}` | Parent trackers: create, list (with their signals and token cost), update, deactivate. Optional `run_if` makes a tracker run only when another tracker's answer matches (if / else) |
| `POST /trackers/{tracker}/signals`, `GET/PUT/DELETE /trackers/{tracker}/signals/{name}` | Signals under a tracker (`choice`, `yes_no`, `score`); every edit is a new version |
| `GET /signals` | Every signal across trackers, flat (read-only) |
| `POST /trackers/import` | Bulk-create trackers and signals from one JSON file (format: `samples/trackers_booking.json`); all or nothing, `dry_run`, `on_conflict=fail\|skip\|update` |
| `POST /overlap`, `GET /overlap` | Jev checks, yes/no per pair, whether trackers overlap or are mutually exclusive; overlapping ones share a `color`. Free: not billed |
| `DELETE /trackers/{tracker}[/signals/{name}]?permanent=true` | Delete for good (without `permanent`: turn off). Past answers are kept. Refused (409) while a condition depends on it |
| `POST /uploads?dry_run=true&trackers=a,b` | Estimate tokens and cost for the chosen trackers, and flag large / over-limit calls, before running anything |
| `POST /uploads?trackers=a,b` (file: .csv / .json / .jsonl, or a recording) | Bulk upload calls and run the chosen trackers (all active ones if omitted); over-30k calls are flagged at once and not charged |
| `GET /uploads`, `GET /uploads/{id}` | Uploads newest first; progress of one |
| `GET /uploads/{id}/results`, `GET /uploads/{id}/export.csv` | Answers grouped by tracker, with confidence, review flag, token counts, and `conditions`: whether each conditional tracker ran |
| `GET /calls/{id}` | One call |
| `DELETE /uploads/{id}`, `DELETE /calls/{id}` | Permanently delete transcripts and answers; billed tokens stay in usage |
| `GET /usage?start=&end=` | Tokens and cost per day; over-limit calls counted separately |
| `GET /insights/dimensions`, `/insights/signals`, `/insights/series`, `/insights/breakdown`, `/insights/movers` | Answers across uploads over a scope (dates, channel, agent, `meta.<key>`, `where=tracker.signal:value`) |
| `GET /calls`, `GET /calls/export.csv`, `PUT/DELETE /calls/{id}/answers/{tracker}/{signal}/review` | Conversations across uploads, their CSV (Pro), and people's corrections for measured accuracy |
| `/dashboards`, `/projects`, `GET /account` | Saved dashboards; projects (every request takes `X-Project`, default project without it) |
| `/alteria/signal`, `/alteria/trackers`, `/alteria/conversations`, `POST /alteria/ask`, `/alteria/threads…` | alteria drafts, Ask alteria with saved and shareable chats |
| `/me`, `/team…`, `/workspace…`, `/onboarding…`, `/invites/{token}`, `/notifications…` | People, roles, invites, the workspace and the bell |
| `/usage/me`, `/usage/members`, `GET /account/overview` | Token usage by person and across the workspace. `/billing` and `/pricing` report billing off |

Uploads take recordings (`.mp3 .wav .m4a .ogg .webm .flac`, up to 30 MB, transcribed by Gemini), `.csv` (any column names, or one row per message), `.json`, `.jsonl`, `.txt`/`.md` (`Speaker: text`), `.vtt` and `.srt`, with optional `channel` and `metadata` per conversation.

## Test

```bash
.venv/Scripts/python -m pytest apps/backend                          # offline, fake Jev
.venv/Scripts/python apps/backend/scripts/smoke_test.py              # live Jev, against ./start.sh's server (costs < $0.01)
cd apps/web && npm run check                                           # UI validation checks
```

`npm run check` works on Node 22 and newer.

## Docs

- [Deploy runbook](docs/google-cup/deploy.md)
- [Backend](apps/backend/README.md) and [web app](apps/web/README.md)
