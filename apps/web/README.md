# aftercall web

The UI for aftercall:
- a landing page (`/`)
- trackers (`/trackers`): what to check in every call. Each tracker holds signals, which are added and edited in a step-by-step modal
- analyse calls (`/analyse`): upload a file, choose trackers, see the estimate, run
- results (`/results`)
- usage (`/usage`)

⌘K opens a command menu anywhere in the app. The theme button (light, dark or match system) is in the sidebar.

It's built with React 19, Vite, Tailwind v4, shadcn/ui (Radix), Motion, React Router, and Geist and Geist Mono.

It talks to the backend (`apps/backend`). The dev server proxies `/api` to it at `http://127.0.0.1:8000`, so there's no CORS to set up.

```bash
# From the repo root: API (in-memory store, demo workspace) + this UI. start.sh puts the demo
# workspace's key in .env.local as AFTERCALL_API_KEY; the dev proxy sends it, the browser never sees it.
./start.sh                   # http://localhost:5173

# Or from apps/web, with the API already running
npm install
npm run dev                  # http://localhost:5173
npm run check                # signal and tracker validation self-check (plain Node)
```

> **Note:** `npm run check` runs a `.ts` file directly with `--experimental-strip-types`, so it works on Node 22 and newer.

Restart `npm run dev` after changing `.env.local`.

**No backend?** Set `VITE_API_MOCK=true` in `.env.local` to run on the in-memory mock (`src/mock-api.ts`), built from `samples/`. With the mock, add `?price=0.5` to the URL to preview costs, and `?fresh` to start with an empty workspace and see first-run onboarding. With the backend, costs appear once `PRICE_PER_MILLION_TOKENS` is set there.

**Names:** the UI calls trackers **trackers** and signals **signals**. The API uses the same names.

## Layout

| Path | What's there |
|---|---|
| `src/pages/` | One file per route. Each route is loaded lazily from `src/main.tsx`. |
| `src/wizard.tsx` | The step-by-step modal for adding or editing a signal, and for creating a tracker. |
| `src/command-menu.tsx` | The ⌘K menu. |
| `src/confirm-delete.tsx` | The confirmation before a tracker or signal is deleted. |
| `src/theme.ts` | Light, dark or system theme (the `.dark` class on `<html>`). |
| `src/ui.tsx` | Shared components: side panel, segmented control, animated numbers, confidence meter, theme button. |
| `src/lib/` | Formatters, hooks, motion presets and `cn`. |
| `src/components/ui/` | shadcn components, retuned to the design tokens in `src/index.css`. Add more with `npx shadcn@latest add <name>`. |
| `src/api.ts` | What the pages import. Picks the HTTP client or the mock. |
| `src/api-types.ts` | Response and request types, mirroring `apps/backend/aftercall/api.py` with the tracker/signal names. |
| `src/http-api.ts` | The real client: `fetch` with `X-API-Key`, backend errors turned into `ApiError`, and backend names mapped to tracker/signal. |
| `src/mock-api.ts` | The in-memory mock (`VITE_API_MOCK=true`). |
| `src/signal-draft.ts` | The wizard's validation, repeating the backend's spec rules, plus `slug()`/`title()` for friendly names. |

## Backend contract

When the backend changes a request or response shape, update `src/api-types.ts` and `src/http-api.ts`, and keep `src/mock-api.ts` in step so the mock still works.

`.env.example` lists the settings:
- `AFTERCALL_API_KEY` (dev server only, never `VITE_`-prefixed)
- `API_PROXY_TARGET`: where the dev proxy points
- `VITE_API_URL`: call the API directly; needs CORS on the backend
- `VITE_API_MOCK`
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`: Google sign-in with Firebase Authentication (public identifiers; the API key is the one `VITE_` key the build allows). Without them the dev proxy's key signs you in.
- `VITE_BILLING`: `on` shows the billing screens; off by default in this build

