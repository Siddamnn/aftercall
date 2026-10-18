// Needs both mock servers: ./start.sh --free and ./start.sh --pro. Screenshots go to $SHOTS.
// Smoke test of the new flows on the mock (free plan on :5173, Pro on :5174). Run: node flows.check.mjs
import { chromium } from '@playwright/test'
const OUT = process.env.SHOTS
const browser = await chromium.launch()
const errors = []
const results = []
async function page(port = 5173) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${p.url()} console: ${m.text()}`))
  p.base = `http://localhost:${port}`
  return p
}
async function step(name, fn) {
  try { await fn(); results.push(`ok   ${name}`) } catch (e) { results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` })

let p = await page()
await step('signed out → login', async () => {
  await p.goto(p.base + '/insights?signed-out'); await p.waitForURL(/\/login/); await p.getByText('Sign in to aftercall').waitFor(); await shot(p, '01-login')
})
await step('email link → check inbox → verify → app', async () => {
  await p.getByLabel('Work email').fill('sam@sunriseclinic.example'); await p.getByRole('button', { name: /Email me a sign-in link/ }).click()
  await p.getByText('Check your email').waitFor(); await shot(p, '02-check-email')
  await p.getByRole('button', { name: /Open the link/ }).click(); await p.waitForURL(/\/insights/, { timeout: 8000 })
  // The free plan's offer opens once after signing in.
  await p.getByRole('button', { name: 'Not now' }).click({ timeout: 6000 })
})
await step('sidebar shows workspace + user', async () => {
  await p.getByRole('button', { name: /Sunrise Clinic, signed in as/ }).waitFor(); await p.waitForTimeout(800); await shot(p, '03-app')
})
await step('notifications bell', async () => {
  await p.getByRole('button', { name: /Notifications, 3 unread/ }).first().click(); await p.getByText('Mark all as read').waitFor(); await shot(p, '04-notifications')
  await p.getByText('Mark all as read').click(); await p.getByRole('button', { name: /^Notifications$/ }).first().waitFor(); await p.keyboard.press('Escape')
})
await step('collapse sidebar with ⌘B, expand again', async () => {
  await p.locator('body').click({ position: { x: 900, y: 500 } }); await p.keyboard.press('Meta+b'); await p.getByRole('button', { name: 'Expand sidebar' }).waitFor(); await shot(p, '05-collapsed')
  await p.getByRole('button', { name: 'Expand sidebar' }).click(); await p.getByRole('button', { name: 'Collapse sidebar' }).waitFor(); await p.waitForTimeout(400)
})
await step('resize sidebar by dragging', async () => {
  const h = p.getByRole('separator', { name: 'Resize the sidebar' }); const b = await h.boundingBox()
  await p.mouse.move(b.x + 5, b.y + 300); await p.mouse.down(); await p.mouse.move(b.x + 85, b.y + 300, { steps: 5 }); await p.mouse.up()
  const v = await h.getAttribute('aria-valuenow'); if (Number(v) < 300) throw new Error(`width ${v}`)
})
await step('settings → workspace, name read-only, rename', async () => {
  await p.goto(p.base + '/settings/workspace'); await p.getByLabel('Workspace name').fill('Sunrise Dental')
  if (await p.locator('#ws-me').count()) throw new Error('your name is editable')
  await p.getByLabel('Address').fill('acme'); await p.getByText('Taken.').waitFor(); await shot(p, '06-workspace-taken')
  await p.getByLabel('Address').fill('sunrise-dental'); await p.getByText('Available').waitFor()
  await p.getByRole('button', { name: 'Save changes' }).click(); await p.getByText(/workspace is now at .*sunrise-dental/).waitFor()
  await p.getByRole('button', { name: /Sunrise Dental, signed in as/ }).waitFor(); await shot(p, '07-workspace-saved')
})
await step('free plan: conversations CSV is gated', async () => {
  await p.goto(p.base + '/insights'); await p.getByRole('button', { name: 'Export' }).click(); await p.getByText('Conversations as CSV').click()
  await p.getByText('Exporting every conversation is part of Pro').waitFor(); await shot(p, '08-gated-export'); await p.keyboard.press('Escape')
})
await step('free plan: 4th Ask question refused', async () => {
  await p.goto(p.base + '/ask'); await p.getByText(/free questions left/).waitFor({ timeout: 8000 }); await shot(p, '09-ask-trial')
})
await step('analyse: no conversion button', async () => {
  await p.goto(p.base + '/analyse'); await p.getByText('Try the sample file').waitFor()
  if (await p.getByText(/Let alteria convert/).count()) throw new Error('convert still there')
})
await step('404 page', async () => { await p.goto(p.base + '/nope-nope'); await p.getByText('Nothing on this line').waitFor(); await p.waitForTimeout(900); await shot(p, '10-404') })
await step('403 page', async () => { await p.goto(p.base + '/unauthorized'); await p.getByText("You don't have access to this").waitFor(); await p.waitForTimeout(600); await shot(p, '11-403') })
await step('500 page', async () => { await p.goto(p.base + '/dev/crash'); await p.getByText('Something went wrong on this page').waitFor(); await shot(p, '12-500') })
await step('dev flows page', async () => { await p.goto(p.base + '/dev/flows'); await p.getByText('Every flow').waitFor(); await shot(p, '13-flows') })
await step('sign out', async () => {
  await p.goto(p.base + '/settings'); await p.getByRole('button', { name: /signed in as/ }).first().click(); await p.getByRole('menuitem', { name: 'Sign out' }).click()
  await p.waitForURL(/\/login\?signed-out/); await p.getByText('You’re signed out.').waitFor()
})
await step('expired link', async () => { await p.goto(p.base + '/login/verify?token=expired'); await p.getByText('That link didn’t work').waitFor() })

p = await page()
await step('onboarding: join by domain', async () => {
  await p.goto(p.base + '/onboarding?onboarding'); await p.getByLabel('Your name').fill('Alex Morgan'); await shot(p, '14-onboarding-name')
  await p.getByRole('button', { name: /Continue/ }).click(); await p.getByText(/Join Sunrise/).waitFor(); await shot(p, '15-onboarding-join')
  await p.getByRole('button', { name: /^Join Sunrise/ }).last().click(); await p.waitForURL(/\/insights/, { timeout: 8000 })
})
p = await page()
await step('onboarding: create a workspace with invites', async () => {
  await p.goto(p.base + '/onboarding?onboarding'); await p.getByLabel('Your name').fill('Alex Morgan'); await p.getByRole('button', { name: /Continue/ }).click()
  await p.getByRole('radio', { name: /Create a new workspace/ }).click(); await p.getByLabel('Workspace name').fill('Northside Physio')
  await p.getByText('Available').waitFor(); await shot(p, '16-onboarding-create')
  await p.getByRole('button', { name: /Continue/ }).click(); await p.getByRole('radio', { name: /Support calls/ }).click(); await p.getByRole('button', { name: /Continue/ }).click()
  await p.getByLabel('Teammate 1 email').fill('sam@sunriseclinic.example'); await shot(p, '17-onboarding-invite')
  await p.getByRole('button', { name: 'Finish' }).click(); await p.waitForURL(/\/trackers/, { timeout: 8000 })
  await p.getByRole('button', { name: /Northside Physio, signed in as Alex Morgan/ }).waitFor()
})
p = await page()
await step('invite page', async () => { await p.goto(p.base + '/invite/demo'); await p.getByText(/Join .* on aftercall/).waitFor(); await shot(p, '18-invite') })
await step('bad invite', async () => { await p.goto(p.base + '/invite/zzz'); await p.getByText('This invite can’t be used').waitFor() })

const pro = await page(5174)
await step('pro plan: conversations CSV not gated', async () => {
  await pro.goto(pro.base + '/insights'); await pro.getByRole('button', { name: 'Export' }).click()
  if (await pro.getByText('Conversations as CSV').locator('..').getByText('Pro').count()) throw new Error('Pro badge shown on Pro')
  await pro.keyboard.press('Escape'); await pro.goto(pro.base + '/settings/credits'); await pro.getByText(/Renews/).waitFor(); await shot(pro, '19-pro-credits')
})
await step('mobile 375 login + app', async () => {
  const m = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
  await m.goto('http://localhost:5174/settings/workspace'); await m.waitForTimeout(1200); await m.screenshot({ path: `${OUT}/20-mobile-workspace.png` })
  const w = await m.evaluate(() => document.documentElement.scrollWidth); if (w > 376) throw new Error(`horizontal scroll ${w}`)
})
const v = await page()
await step('viewer: hidden nav, no money, blocked page', async () => {
  await v.goto(v.base + '/insights?role=viewer'); await v.getByRole('link', { name: 'Insights' }).first().waitFor()
  if (await v.getByRole('link', { name: 'Analyse calls' }).count()) throw new Error('Analyse visible to viewer')
  if (await v.getByRole('link', { name: 'Trackers' }).count()) throw new Error('Trackers visible to viewer')
  await v.goto(v.base + '/analyse'); await v.getByText("You don't have access to this").waitFor(); await shot(v, '21-viewer-blocked')
  await v.goto(v.base + '/settings'); await v.getByRole('link', { name: 'Workspace' }).waitFor()
  if (await v.getByRole('link', { name: 'Plan and credits' }).count()) throw new Error('credits tab visible to viewer')
})
const mem = await page()
await step('member: read-only credits, own usage', async () => {
  await mem.goto(mem.base + '/settings/credits?role=member'); await mem.getByText('The owner and admins add them').waitFor()
  if (await mem.getByRole('link', { name: 'Add credits' }).count()) throw new Error('member can add credits')
  await mem.goto(mem.base + '/settings/usage'); await mem.getByText('Your monthly allowance').waitFor(); await mem.getByText('The whole workspace').waitFor(); await shot(mem, '22-member-usage')
})
const own = await page()
await step('owner: allowances in rupees, per role and person, confirm', async () => {
  await own.goto(own.base + '/settings/usage?role=owner&currency=INR'); await own.getByText('By person').waitFor()
  await own.getByRole('link', { name: 'Manage allowances' }).click(); await own.getByRole('heading', { name: 'Allowances' }).waitFor()
  await own.getByLabel('Viewer share, percent').fill('30'); await own.getByRole('button', { name: 'Review and save' }).click()
  await own.getByText('Save these allowances?').waitFor(); await own.getByRole('button', { name: 'Save allowances' }).click()
  await own.getByText('Allowances saved').waitFor(); await shot(own, '23-owner-allowances')
})
await step('docs search: arrow keys move the highlight', async () => {
  await own.goto(own.base + '/docs'); const box = own.getByLabel('Search the docs'); await box.click(); await box.pressSequentially('credits')
  await own.locator('[role=option][aria-selected=true]').waitFor()
  const first = await own.locator('[role=option][aria-selected=true]').innerText()
  await own.keyboard.press('ArrowDown'); const second = await own.locator('[role=option][aria-selected=true]').innerText()
  if (first === second) throw new Error('highlight did not move')
})
await step('pricing in rupees with promotion', async () => {
  await own.goto(own.base + '/pricing?currency=INR'); await own.getByText(/Launch offer/).waitFor(); await own.getByText(/Prices in INR/).waitFor(); await own.waitForTimeout(600); await shot(own, '24-pricing-inr')
})
await step('discount code at checkout', async () => {
  await own.goto(own.base + '/settings/credits/add?currency=USD'); await own.getByRole('textbox', { name: 'Discount code' }).fill('WELCOME20'); await own.getByRole('button', { name: 'Apply' }).click()
  await own.getByText(/20% off a top-up/).waitFor(); await own.getByRole('button', { name: /Pay \$20/ }).waitFor(); await shot(own, '25-discount')
  await own.getByRole('textbox', { name: 'Discount code' }).fill('BETA50'); await own.getByRole('button', { name: 'Apply' }).click(); await own.getByText('BETA50 has ended.').waitFor()
})
const d = await page()
await step('docs landing, search, article with TOC', async () => {
  await d.goto(d.base + '/docs'); await d.getByText('How can we help?').waitFor(); await d.waitForTimeout(700); await shot(d, '27-docs')
  await d.getByLabel('Search the docs').fill('confidence'); await d.getByRole('option').first().waitFor()
  await d.goto(d.base + '/docs/glossary'); await d.getByRole('heading', { name: 'Glossary', level: 1 }).waitFor()
  await d.goto(d.base + '/docs/privacy'); await d.getByText('This page hasn’t had legal review yet').waitFor(); await d.getByRole('navigation', { name: 'On this page' }).waitFor(); await d.waitForTimeout(500); await shot(d, '28-docs-privacy')
  await d.goto(d.base + '/guide'); await d.waitForURL(/docs\/import-trackers/)
  await d.goto(d.base + '/terms'); await d.waitForURL(/docs\/terms/)
})
await step('customer app has no Pricing Config', async () => {
  await d.goto(d.base + '/internal/pricing'); await d.getByText('Nothing on this line').waitFor()
  await d.goto(d.base + '/admin/pricing'); await d.getByText('Nothing on this line').waitFor()
})
const f = await page()
await step('free plan: upgrade card, popup after sign-in', async () => {
  await f.goto(f.base + '/login?signed-out'); await f.getByLabel('Work email').fill('sam@sunriseclinic.example'); await f.getByRole('button', { name: /Email me a sign-in link/ }).click()
  await f.getByRole('button', { name: /Open the link/ }).click(); await f.waitForURL(/insights/)
  await f.getByText('Your team, on Pro').waitFor({ timeout: 6000 }); await f.waitForTimeout(500); await shot(f, '29-upgrade-popup')
  await f.getByRole('button', { name: 'Not now' }).click(); await f.getByText('Get more with Pro').waitFor(); await shot(f, '30-upgrade-card')
})
const sx = await page()
await step('session: warning, sign-out, resume the page', async () => {
  await sx.goto(sx.base + '/login?signed-out&session=330'); await sx.getByLabel('Work email').fill('sam@sunriseclinic.example'); await sx.getByRole('button', { name: /Email me a sign-in link/ }).click()
  await sx.getByRole('button', { name: /Open the link/ }).click(); await sx.waitForURL(/insights/)
  await sx.goto(sx.base + '/dashboards'); await sx.getByText(/You’ll be signed out at/).waitFor({ timeout: 45000 }); await shot(sx, '31-session-warning')
})
const pro2 = await page(5174)
await step('pro plan: no upgrade card', async () => {
  await pro2.goto(pro2.base + '/insights'); await pro2.getByRole('link', { name: 'Insights' }).first().waitFor(); await pro2.waitForTimeout(800)
  if (await pro2.getByText('Get more with Pro').count()) throw new Error('upgrade card on Pro')
})
console.log(results.join('\n'))
console.log(errors.length ? `\nPage errors:\n${[...new Set(errors)].slice(0, 15).join('\n')}` : '\nNo page errors')
await browser.close()
