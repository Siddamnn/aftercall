# aftercall backend

The FastAPI API on Google Cloud: Firestore records, Cloud Tasks per call, Gemini, Firebase Auth, and Jev for the signals. Settings are read from the repo-root `.env` (see `../../.env.example`), or from Cloud Run's environment.

```bash
# from the repo root
.venv/Scripts/python -m pip install -e "apps/backend[dev]"
./start.sh                                                       # API + web, in-memory store, demo workspace

# from apps/backend
../../.venv/Scripts/python -m uvicorn aftercall.api:app          # API only (calls run in-process without CLOUD_TASKS_QUEUE)
../../.venv/Scripts/python -m pytest                             # offline tests
../../.venv/Scripts/python scripts/smoke_test.py                 # live Jev end-to-end, against a running server
```

CLI (`aftercall/cli.py`): `create-tenant`, `rotate-key` and `alteria-costs`, against the configured store (useful with `STORE_BACKEND=firestore`; the memory store lives only inside the running server).

## Layout

- `aftercall/api.py` builds the app (and strips the `/api` prefix Firebase Hosting forwards); the routes are in `aftercall/routes/`, one module per area (trackers, uploads, tasks, insights, dashboards, projects, alteria, people, workspace, notifications, usage, billing, docs).
- `aftercall/store.py` is the only data layer (Firestore, or memory); `aftercall/models.py` holds the records.
- `aftercall/deps.py` says who is asking (an API key acts as the workspace's owner; a Firebase ID token is a person with a role, via `firebase_auth.py`), and which project (`X-Project`, else the default one). `aftercall/permissions.py` is the one map of what each role may do.
- Calls: `routes/uploads.py` takes uploads and queues calls through `tasks.py` (Cloud Tasks); `routes/tasks.py` receives each task and `worker.py` transcribes recordings (`transcribe.py`, `storage.py`) and runs Jev (`jev.py`, `planner.py`).
- Ask alteria: `alteria.py`, `ask.py`, `threads.py`, on Gemini (`llm.py`), with Jev choosing the tier (`router.py`).
- The rest: `insights.py`, `people.py`, `workspaces.py`, `notify.py`, `usage.py`, `formats.py` (transcripts in any layout), `ingest.py`; `billing.py` and `pricing.py` report billing off in this build.

The endpoint list is in the [root README](../../Readme.md); the Google Cloud plan and deploy steps are in [docs/google-cup/](../../docs/google-cup/).
