import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Anything named VITE_* is compiled into the JavaScript every visitor downloads. A key or secret
// there is public, so the build refuses to start with one.
const SECRET = /KEY|SECRET|TOKEN|PASSWORD|PRIVATE/i
// Firebase's web apiKey only identifies the project to Google's sign-in service; it grants nothing
// by itself (access is decided by Firebase Auth rules and the backend verifying ID tokens), and
// Google's own docs ship it in the page. The one name allowed through; every other VITE_*KEY stays refused.
const PUBLIC_IDENTIFIERS = new Set(['VITE_FIREBASE_API_KEY'])

function noSecretsInBundle(env: Record<string, string>): Plugin {
  return {
    name: 'aftercall:no-secrets-in-bundle',
    config() {
      const leaked = Object.keys(env).filter((k) => k.startsWith('VITE_') && SECRET.test(k) && !PUBLIC_IDENTIFIERS.has(k))
      if (leaked.length) {
        throw new Error(
          `${leaked.join(', ')} would be shipped to every browser. Rename it without the VITE_ prefix ` +
            '(e.g. AFTERCALL_API_KEY): the dev server adds it to /api requests, and the browser never sees it.',
        )
      }
    },
  }
}

// robots.txt and sitemap.xml, written from VITE_APP_HOST so a new domain is one setting.
// Only the public pages are for search engines; the app is behind sign-in, and sign-in and invite
// links are one-time. App pages also say noindex (useNoIndex), since robots.txt only stops crawling.
const PRIVATE = ['/login', '/signup', '/login/verify', '/invite/', '/onboarding', '/insights', '/ask', '/dashboards', '/trackers', '/analyse', '/results', '/projects', '/settings', '/guide', '/dev/', '/api/']
// Public docs pages for the sitemap ('' is the /docs landing). Keep in step with src/docs/registry.tsx.
const DOCS = ['', 'how-aftercall-works', 'first-analysis', 'glossary', 'trackers-and-signals', 'analysing-conversations', 'results-and-review', 'insights', 'dashboards', 'ask-alteria', 'projects', 'exports', 'import-trackers', 'workspace-and-roles', 'invite-teammates', 'notifications', 'sign-in-and-security', 'plans', 'credits', 'usage', 'currency-and-discounts', 'faq', 'support', 'privacy', 'terms', 'dpa', 'cookies', 'acceptable-use', 'security']
function seoFiles(host: string, billing: boolean): Plugin {
  const site = `https://${host}`
  const files: Record<string, string> = {
    'robots.txt': ['User-agent: *', 'Allow: /$', ...(billing ? ['Allow: /pricing'] : []), 'Allow: /docs', ...PRIVATE.map((p) => `Disallow: ${p}`), '', `Sitemap: ${site}/sitemap.xml`, ''].join('\n'),
    'sitemap.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>${site}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
      ...(billing ? [`  <url><loc>${site}/pricing</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`] : []),
      ...DOCS.map((d) => `  <url><loc>${site}/docs${d ? `/${d}` : ''}</loc><changefreq>monthly</changefreq><priority>${d ? '0.5' : '0.7'}</priority></url>`),
      '</urlset>',
      '',
    ].join('\n'),
  }
  return {
    name: 'aftercall:seo-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const f = files[req.url?.slice(1) ?? '']
        if (!f) return next()
        res.setHeader('Content-Type', req.url!.endsWith('.xml') ? 'application/xml' : 'text/plain')
        res.end(f)
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const mock = env.VITE_API_MOCK === 'true'
  return {
    plugins: [noSecretsInBundle(env), seoFiles(env.VITE_APP_HOST || 'aftercall.app', env.VITE_BILLING === 'on'), react(), tailwindcss()],
    resolve: {
      alias: {
        // The API the pages use, chosen at build time so the mock (and its made-up data) is never
        // in a real build, and the real client is never in a mock one. See src/api.ts.
        '@api-impl': path.resolve(import.meta.dirname, mock ? './src/mock-api.ts' : './src/http-api.ts'),
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    build: { sourcemap: false },
    server: {
      // The mock API and the "try the sample file" button read the shared samples in ../../samples.
      fs: { allow: ['../..'] },
      // /api/* goes to the backend (uvicorn aftercall.api:app), so the browser sees one origin.
      // In dev the proxy adds the tenant's key here, on the server: it's never in the browser.
      // Deployed (Firebase Hosting), /api is rewritten to Cloud Run and the browser sends a Firebase ID token.
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
          headers: env.AFTERCALL_API_KEY ? { 'X-API-Key': env.AFTERCALL_API_KEY } : {},
        },
      },
    },
  }
})
