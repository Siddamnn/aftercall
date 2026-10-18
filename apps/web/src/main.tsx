import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import App from './App'
// The status pages are small and shared by every route's error screen, so they load with the app.
import NotFound, { Crashed, Forbidden, SignedOut } from './pages/Status'
import { PageLoader } from './loaders'
import { RequireAuth } from './session'
import { TooltipProvider } from './components/ui/tooltip'
import './index.css'

// Each page loads on first visit, so the landing page doesn't ship the app.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default })

const router = createBrowserRouter([
  // One parent for every page, so the first load shows the logo loader (and the router has its fallback).
  {
    hydrateFallbackElement: <PageLoader full />,
    children: [
  { index: true, lazy: page(() => import('./pages/Landing')), errorElement: <Crashed /> },
  // No billing in this build: there is nothing to price, so these addresses go home.
  { path: 'pricing', element: <Navigate to="/" replace /> },
  // Signing in, joining and setting up: outside the app, no sign-in needed to see them.
  { path: 'login', lazy: page(() => import('./pages/Login')), errorElement: <Crashed /> },
  { path: 'signup', lazy: page(() => import('./pages/Login')), errorElement: <Crashed /> },
  { path: 'login/verify', lazy: async () => ({ Component: (await import('./pages/Login')).Verify }), errorElement: <Crashed /> },
  { path: 'invite/:token', lazy: page(() => import('./pages/Invite')), errorElement: <Crashed /> },
  { path: 'onboarding', lazy: page(() => import('./pages/Onboarding')), errorElement: <Crashed /> },
  // Docs: public, so they can be found and linked. Legal pages also at their usual short addresses.
  { path: 'docs', lazy: page(() => import('./pages/Docs')), errorElement: <Crashed /> },
  { path: 'docs/api/*', element: <Navigate to="/docs" replace /> },
  { path: 'docs/:slug', lazy: async () => ({ Component: (await import('./pages/Docs')).DocsArticle }), errorElement: <Crashed /> },
  ...['privacy', 'terms', 'security', 'cookies', 'dpa'].map((s) => ({ path: s, element: <Navigate to={`/docs/${s}`} replace /> })),
  { path: 'unauthorized', Component: Forbidden },
  { path: 'signed-out', Component: SignedOut },
  {
    element: <RequireAuth><App /></RequireAuth>,
    errorElement: <Crashed />,
    hydrateFallbackElement: <PageLoader full />,
    children: [
      // The signal wizard: /trackers/_new (new tracker), /trackers/{tracker}/_new, /trackers/{tracker}/{signal}.
      { path: 'insights', lazy: page(() => import('./pages/Insights')) },
      { path: 'ask/:threadId?', lazy: page(() => import('./pages/Ask')) },
      { path: 'dashboards/:id?', lazy: page(() => import('./pages/Dashboards')) },
      { path: 'projects', lazy: page(() => import('./pages/Projects')) },
      { path: 'guide', element: <Navigate to="/docs/import-trackers" replace /> },
      { path: 'trackers/:tracker?/:signal?', lazy: page(() => import('./pages/Trackers')) },
      { path: 'analyse', lazy: page(() => import('./pages/Analyse')) },
      // Old links.
      { path: 'questions/*', element: <Navigate to="/trackers" replace /> },
      { path: 'upload', element: <Navigate to="/analyse" replace /> },
      { path: 'results/:uploadId?/:callId?', lazy: page(() => import('./pages/Results')) },
      // Settings (B46): Overview, Plan and credits, Usage. /usage moved in here.
      { path: 'settings/credits/add', element: <Navigate to="/settings" replace /> },
      { path: 'settings/usage/allowances', lazy: page(() => import('./pages/Allowances')) },
      { path: 'settings/:tab?', lazy: page(() => import('./pages/Settings')) },
      { path: 'usage', element: <Navigate to="/settings/usage" replace /> },
    ],
  },
  { path: '*', Component: NotFound },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
)
