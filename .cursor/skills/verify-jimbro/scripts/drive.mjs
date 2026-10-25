#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { chromium, webkit } from '@playwright/test'

const base = process.env.JIMBRO_VERIFY_URL
if (!base) {
  console.error('JIMBRO_VERIFY_URL is not set')
  process.exit(1)
}

const artifactsRoot = process.env.JIMBRO_ARTIFACTS_DIR
const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
// Ilias and Ena train in Athens, so "today" and the week follow its clock.
const TIME_ZONE = 'Europe/Athens'

// The two phones Jimbro is used on, each in its own browser's engine: Ena's iPhone runs Safari, so WebKit, and Ilias's
// Pixel runs Chrome, so Chromium. CI runs the tour this way on every pull request.
const DEVICES = {
  iphone13: {
    engine: 'webkit',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  },
  pixel8pro: {
    engine: 'chromium',
    viewport: { width: 448, height: 998 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
  }
}

// Playwright's own Chromium when it is installed. Otherwise JIMBRO_CHROMIUM, or the image's
// /opt/pw-browsers/chromium in Claude Code cloud sessions, whose build can differ from Playwright's.
function chromiumPath() {
  if (existsSync(chromium.executablePath())) return undefined
  const fallback = process.env.JIMBRO_CHROMIUM ?? '/opt/pw-browsers/chromium'
  if (existsSync(fallback)) return fallback
  throw new Error('No Chromium found. Run `vp exec playwright install chromium` or set JIMBRO_CHROMIUM.')
}

// The browser a phone runs in. Where Playwright's WebKit is not installed, as in Claude Code cloud sessions, the iPhone
// runs in Chromium instead, which shows its size but not how Safari lays it out, and the contact sheet says so.
function browserFor(device) {
  if (DEVICES[device].engine === 'webkit' && existsSync(webkit.executablePath())) return 'webkit'
  if (DEVICES[device].engine === 'webkit') console.warn(`WebKit is not installed, so ${device} runs in Chromium.`)
  return 'chromium'
}

// A fresh context per device, so IndexedDB starts empty. Reduced motion keeps screenshots still, the way
// src/style.css and animateDetails.ts stop their animations.
async function withPage(device, fn) {
  const engine = browserFor(device)
  const browser =
    engine === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: chromiumPath() })
  const { engine: _wanted, ...profile } = DEVICES[device]
  const context = await browser.newContext({
    ...profile,
    baseURL: base,
    timezoneId: TIME_ZONE,
    reducedMotion: 'reduce'
  })
  const page = await context.newPage()
  // A stop that fails should fail fast, not hold up every stop after it.
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    return await fn(page, errors, engine)
  } finally {
    await browser.close()
  }
}

const see = (locator) => locator.first().waitFor({ state: 'visible' })
const gone = (locator) => locator.first().waitFor({ state: 'hidden' })

// Waits until a canvas keeps its size and pixels for five frames in a row, so a chart has finished drawing and
// resizing. A canvas resized but not yet redrawn shows its old drawing stretched for a frame.
const stillCanvas = (locator) =>
  locator.evaluate(
    (canvas) =>
      new Promise((resolve) => {
        let last = ''
        let same = 0
        const check = () => {
          const now = `${canvas.width}x${canvas.height} ${canvas.clientWidth}x${canvas.clientHeight} ${canvas.toDataURL()}`
          same = now === last && now.length > 2000 ? same + 1 : 0
          last = now
          if (same >= 5) resolve(undefined)
          else requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })
  )

async function snapshot(route, outDir) {
  await withPage(process.env.JIMBRO_VERIFY_DEVICE ?? 'iphone13', async (page) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await see(page.locator('h1.app-header-title'))
    mkdirSync(outDir, { recursive: true })
    await page.screenshot({ path: resolve(outDir, 'page.png'), fullPage: true })
    writeFileSync(resolve(outDir, 'page.aria.yml'), await page.locator('body').ariaSnapshot())
    writeFileSync(resolve(outDir, 'proof.txt'), `feature: snapshot\nurl: ${page.url()}\nentry: GET ${route}\n`)
    console.log(`Wrote snapshot of ${page.url()} to ${outDir}`)
  })
}

const todayIn = (timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const addDays = (day, days) => {
  const [year, month, date] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, date + days))
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
}

const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

// The worker's real-data fixture (a year of sessions at several gyms), with every date moved so the
// latest session was last Sunday. This week then has no workouts yet and home suggests one. The tour
// imports it through Settings, so the screens show real history.
function writeFixture(outDir) {
  const fixture = JSON.parse(readFileSync(join(repoRoot, 'worker', 'test', 'fixtures', 'latest-v4.json'), 'utf8'))
  const sessions = fixture.stores.workoutSessions
  const latest = sessions.map((session) => session.date).sort().at(-1)
  const today = todayIn(TIME_ZONE)
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  const shift = daysBetween(latest, addDays(today, -sinceMonday - 1))
  for (const session of sessions) session.date = addDays(session.date, shift)
  const path = join(outDir, 'fixture.json')
  writeFileSync(path, JSON.stringify(fixture))
  return path
}

const base64Url = (bytes) => Buffer.from(bytes).toString('base64url')

// Whether the canned worker refuses pushes as it does once a sign-in on another device moved the account there.
let movedElsewhere = false

// A virtual authenticator on the page, and canned answers in place of the worker for a passkey sign-up, a sign-in on a
// phone whose account another device backs up, the sync after it and a sign-out. The tour's API base is a dead address,
// so nothing else would answer.
async function withPasskeyWorker(page) {
  movedElsewhere = false
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  })
  const answers = {
    '/auth/register/options': () => ({
      challenge: base64Url(crypto.getRandomValues(new Uint8Array(32))),
      rp: { id: 'localhost', name: 'Jimbro' },
      user: { id: base64Url(Buffer.from('tour-user')), name: 'Jimbro', displayName: 'Jimbro' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none',
      timeout: 300_000,
      excludeCredentials: []
    }),
    '/auth/register/verify': () => ({ userId: 'tour-user', token: 'tour-token' }),
    '/auth/signin/options': () => ({
      challenge: base64Url(crypto.getRandomValues(new Uint8Array(32))),
      rpId: 'localhost',
      userVerification: 'required',
      timeout: 300_000
    }),
    '/auth/signin/verify': () => ({ userId: 'tour-user', token: 'tour-token', otherDevices: 1 }),
    '/api/claim': () => ({ signedOut: 1 }),
    '/api/signout': () => ({ ok: true }),
    '/api/pull': () => ({ rows: [], cursor: 0, more: false }),
    '/api/push': () => ({ revision: 1 })
  }
  await page.route(
    (url) => url.pathname in answers,
    (route) => {
      const headers = {
        'Access-Control-Allow-Origin': route.request().headers().origin ?? '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const path = new URL(route.request().url()).pathname
      if (movedElsewhere && path === '/api/push') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' }, headers })
      }
      return route.fulfill({ json: answers[path](), headers })
    }
  )
}

// Each stop puts one screen or dialog on the phone and waits for what proves it is there. The tour runs
// them in order in one context, so a stop may rely on the state the stops before it left. The passkey stops need
// Chromium's virtual authenticator, so WebKit skips them, as tests/passkeys.spec.ts does.
/** @type {Array<[string, (page: import('@playwright/test').Page, context: { fixture: string }) => Promise<void>]>} */
const STOPS = [
  ['home-empty', async (page) => {
    await page.goto('/')
    await see(page.getByText("Let's set up your first workout."))
  }],
  ['workouts-empty', async (page) => {
    await page.getByRole('link', { name: 'Get started' }).click()
    await see(page.getByRole('button', { name: 'Seed Database' }))
    await see(page.getByRole('button', { name: 'Sign in with passkey' }))
  }],
  ['settings-import', async (page, { fixture }) => {
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()
    await page.locator('#import-input').setInputFiles(fixture)
    await see(page.locator('.toast-message-popup', { hasText: 'Database imported!' }))
  }],
  ['home', async (page) => {
    await page.getByRole('link', { name: 'Home' }).click()
    await see(page.locator('.program-pick[data-suggested]'))
    await see(page.locator('#highlights'))
  }],
  ['workouts', async (page) => {
    await page.getByRole('link', { name: 'Workouts' }).click()
    await see(page.locator('.workout-week'))
  }],
  ['workouts-new-dialog', async (page) => {
    await page.getByRole('button', { name: 'Add new workout' }).click()
    await see(page.locator('#new-workout-dialog a.program-link'))
  }],
  ['workouts-mode-dialog', async (page) => {
    await page.locator('#new-workout-dialog').getByRole('button', { name: 'Close dialog' }).click()
    await gone(page.locator('#new-workout-dialog'))
    await page.locator('#week-progress').click()
    await see(page.locator('#workout-mode-dialog'))
  }],
  ['exercises', async (page) => {
    await page.goto('/exercises/')
    await see(page.locator('#exercises-grid .card'))
  }],
  ['exercise-dialog-edit', async (page) => {
    await page.locator('#exercises-grid .card').first().click()
    await see(page.locator('#exercise-dialog'))
  }],
  ['exercise-dialog-new-cardio', async (page) => {
    await page.locator('#exercise-dialog').getByRole('button', { name: 'Close dialog' }).click()
    await gone(page.locator('#exercise-dialog'))
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Kind').selectOption('cardio')
    await gone(page.locator('#exercise-muscle-field'))
  }],
  ['exercise-dialog-new-rehab', async (page) => {
    await page.getByLabel('Kind').selectOption('rehab')
    await see(page.locator('#exercise-preset-field'))
  }],
  ['programs', async (page) => {
    await page.goto('/programs/')
    await see(page.locator('#programs-grid > .card'))
  }],
  ['programs-expanded', async (page) => {
    const card = page.locator('#programs-grid > .card').first()
    await card.locator('summary').click()
    await see(card.locator('details[open]'))
  }],
  ['program-dialog', async (page) => {
    await page.locator('.edit-program-btn').first().click()
    await see(page.locator('#program-dialog'))
  }],
  ['stats', async (page) => {
    await page.goto('/')
    await page.getByRole('link', { name: /lifted this week/ }).click()
    await see(page.locator('#stat-total-sets'))
  }],
  ['settings', async (page) => {
    await page.goto('/settings/')
    await see(page.locator('#cloud-backup-details'))
  }],
  ['settings-expanded', async (page) => {
    await page.locator('#workout-settings-details summary').click()
    await page.locator('#cloud-backup-details > summary').click()
    await see(page.getByRole('button', { name: 'Create passkey' }))
  }],
  ['settings-token', async (page) => {
    await page.locator('#cloud-token-details > summary').click()
    await see(page.locator('#cloud-userid'))
    // The bottom nav covers the end of the page, so the section scrolls to the top.
    await page.locator('#passkey-offer').evaluate((offer) => offer.scrollIntoView({ block: 'start' }))
  }],
  ['settings-gyms', async (page) => {
    await page.locator('#gyms-details summary').click()
    await see(page.locator('#rename-gym-form'))
    await page.locator('#gyms-details').scrollIntoViewIfNeeded()
  }],
  ['gymtime-new', async (page) => {
    await page.goto('/')
    await page.locator('.program-pick[data-suggested]').click()
    await page.waitForURL('**/gymtime/?*')
    await see(page.locator('#exercises-list > .card'))
  }],
  ['gymtime-details', async (page) => {
    await page.locator('#workout-details > summary').click()
    await see(page.locator('#workout-details input[name="date"]'))
  }],
  ['gymtime-started', async (page) => {
    // The first change starts the workout: here, Add set on the first card.
    await page.locator('#workout-details > summary').click()
    const card = page.locator('details.exercise-details').first()
    if ((await card.getAttribute('open')) === null) await card.locator('summary').click()
    await card.getByRole('button', { name: 'Add set' }).click()
    await see(page.locator('.toast-message-popup', { hasText: 'Workout started' }))
    await page.waitForURL('**/gymtime/?id=*')
  }],
  ['gymtime-card-open', async (page) => {
    const card = page.locator('details.exercise-details').first()
    if ((await card.getAttribute('open')) === null) await card.locator('summary').click()
    await see(card.locator('.next-set-form button[type=submit]'))
    await card.locator('.next-set-form button[type=submit]').scrollIntoViewIfNeeded()
  }],
  ['gymtime-set-menu', async (page) => {
    const card = page.locator('details.exercise-details').first()
    const rows = card.getByRole('button', { name: /, to do$/ })
    // A tap on another row while the menu is open only closes it, so the last row's menu takes a second tap.
    await rows.first().click()
    await see(card.locator('.set-menu'))
    await rows.last().click()
    await gone(page.locator('.set-menu:popover-open'))
    await rows.last().click()
    await see(card.locator('.set-menu'))
  }],
  ['break-timer', async (page) => {
    await page.keyboard.press('Escape')
    await gone(page.locator('.set-menu:popover-open'))
    const form = page.locator('details.exercise-details').first().locator('.next-set-form')
    const reps = form.locator('input[name="set-reps"]')
    if ((await reps.count()) > 0 && (await reps.first().inputValue()) === '') await reps.first().fill('8')
    const weight = form.locator('input[name="set-weight"]')
    if ((await weight.count()) > 0 && (await weight.first().inputValue()) === '') await weight.first().fill('40')
    await form.getByRole('button', { name: 'Finished set' }).click()
    await see(page.locator('#break-countdown-dialog'))
  }],
  ['break-timer-minimized', async (page) => {
    await page.locator('#minimize-break').click()
    await see(page.locator('#break-countdown-dialog.dialog-minimized'))
  }],
  ['edit-set-dialog', async (page) => {
    await page.goto(page.url())
    const card = page.locator('details.exercise-details').first()
    if ((await card.getAttribute('open')) === null) await card.locator('summary').click()
    await card.locator('.completed-sets .set.isCompleted').first().click()
    await see(page.locator('#edit-set-dialog'))
  }],
  ['previous-sets-dialog', async (page) => {
    await page.locator('#edit-set-dialog').getByRole('button', { name: 'Close dialog' }).click()
    await gone(page.locator('#edit-set-dialog'))
    await page.locator('details.exercise-details').first().locator('.view-last-set-btn').click()
    await see(page.locator('#last-set-dialog'))
  }],
  ['previous-sets-older', async (page) => {
    const dialog = page.locator('#last-set-dialog')
    await dialog.locator('#last-set-older:enabled').click()
    await see(dialog.locator('#last-set-newer:enabled'))
  }],
  ['history-chart-dialog', async (page) => {
    await page.locator('#last-set-dialog').getByRole('button', { name: 'Close dialog' }).click()
    await gone(page.locator('#last-set-dialog'))
    await page.locator('details.exercise-details').first().locator('.view-history-btn').click()
    const canvas = page.locator('#exercise-history-dialog canvas')
    await see(canvas)
    await stillCanvas(canvas)
  }],
  ['gymtime-card-menu', async (page) => {
    await page.locator('#exercise-history-dialog').getByRole('button', { name: 'Close dialog' }).click()
    await gone(page.locator('#exercise-history-dialog'))
    const card = page.locator('[data-exercise-id]').nth(1)
    await card.locator('.exercise-actions-btn').click()
    await see(card.locator('.exercise-actions-menu'))
  }],
  ['add-exercise-dialog', async (page) => {
    await page.keyboard.press('Escape')
    await page.locator('#add-exercise-card').click()
    await see(page.locator('#add-exercise-dialog'))
  }],
  ['gymtime-passkey-offer', async (page) => {
    await page.keyboard.press('Escape')
    await gone(page.locator('#add-exercise-dialog'))
    // Leaves only the first exercise, then logs its sets until the workout is done.
    const cards = page.locator('#exercises-list > [data-exercise-id]')
    for (let count = await cards.count(); count > 1; count = await cards.count()) {
      const card = cards.nth(1)
      await card.locator('.exercise-actions-btn').click()
      await card.locator('.delete-workout-session-exercise-btn').click()
      await page.waitForFunction(
        (before) => document.querySelectorAll('#exercises-list > [data-exercise-id]').length < before,
        count
      )
    }
    const card = cards.first()
    const pending = card.locator('.completed-sets .set.isPending')
    const breakTimer = page.locator('#break-countdown-dialog')
    for (let left = await pending.count(); left > 0; left = await pending.count()) {
      if ((await card.locator('.exercise-details').getAttribute('open')) === null) {
        await card.locator('.exercise-details > summary').click()
      }
      await card.locator('.next-set-form').getByRole('button', { name: 'Finished set' }).click()
      await page.waitForFunction(
        ([id, before]) =>
          document.querySelectorAll(`[data-exercise-id="${id}"] .completed-sets .set.isPending`).length < before,
        [await card.getAttribute('data-exercise-id'), left]
      )
      if (await breakTimer.isVisible()) {
        await page.locator('#skip-break').click()
        await gone(breakTimer)
      }
    }
    const offer = page.getByRole('region', { name: 'Back up your workouts' })
    await see(offer)
    // The "Workout done!" stamp covers the card for a few seconds.
    await gone(page.locator('.confetti'))
    await offer.scrollIntoViewIfNeeded()
  }],
  ['settings-passkey', async (page) => {
    // WebAuthn takes no IP address as the RP ID, so this stop runs on localhost, an origin of its own with an empty
    // database. Chromium's virtual authenticator stands in for the phone's password manager, and canned answers for
    // the worker, which a tour never reaches.
    await withPasskeyWorker(page)
    await page.goto(base.replace('127.0.0.1', 'localhost') + '/settings/')
    await page.locator('#cloud-backup-details > summary').click()
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await see(page.getByText('Your workouts are backed up with a passkey.'))
    await see(page.getByRole('button', { name: 'Sign out' }))
    await gone(page.locator('.toast-message-popup'))
  }],
  ['settings-signed-out', async (page) => {
    // The tour accepts the sign-out confirm. A phone that signed out offers signing in first.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await see(page.locator('#cloud-backup-details .btn-primary', { hasText: 'Sign in with passkey' }))
    await gone(page.locator('.toast-message-popup'))
  }],
  ['settings-moved', async (page) => {
    // The tour accepts the sign-in's confirm that the backup moves here. Then a sign-in on another device takes it
    // back, so the next push is refused and this phone says it stopped backing up.
    await page.getByRole('button', { name: 'Sign in with passkey' }).click()
    await see(page.getByRole('button', { name: 'Sign out' }))
    await gone(page.locator('.toast-message-popup'))
    movedElsewhere = true
    await page.evaluate(async () => {
      const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
      await exercisesStore.create({
        name: 'Squat',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'quads',
        targetSets: 3,
        defaults: { reps: 5 }
      })
    })
    await page.getByRole('button', { name: 'Sync now' }).click()
    await see(page.getByText('Your backup moved to another device, so this phone stopped backing up.'))
    await gone(page.locator('.toast-message-popup'))
  }],
  ['gymtime-error', async (page) => {
    await page.goto('/gymtime/?programId=missing')
    await see(page.getByRole('link', { name: 'Back to workouts' }))
  }]
]

const CHROMIUM_ONLY = new Set(['settings-passkey', 'settings-signed-out', 'settings-moved'])

async function tour(devices, only) {
  const outDir = resolve(artifactsRoot, 'tour')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const fixture = writeFixture(outDir)
  const results = {}
  const engines = {}
  for (const device of devices) {
    const dir = join(outDir, device)
    mkdirSync(dir, { recursive: true })
    results[device] = await withPage(device, async (page, errors, engine) => {
      engines[device] = engine
      page.on('dialog', (dialog) => void dialog.accept())
      /** @type {Record<string, { file?: string, error?: string, skipped?: string, pageErrors?: string[] }>} */
      const shots = {}
      for (const [index, [slug, go]] of STOPS.entries()) {
        const file = `${String(index + 1).padStart(2, '0')}-${slug}.png`
        if (engine !== 'chromium' && CHROMIUM_ONLY.has(slug)) {
          shots[slug] = { skipped: "Chromium only: it needs Chromium's virtual authenticator." }
          continue
        }
        try {
          await go(page, { fixture })
          if (only && !slug.includes(only)) continue
          await page.screenshot({ path: join(dir, file) })
          shots[slug] = { file: `${device}/${file}` }
        } catch (error) {
          shots[slug] = { error: error.message.split('\n')[0] }
          console.error(`${device} ${slug}: ${shots[slug].error}`)
        }
        if (errors.length > 0) {
          shots[slug] = { ...shots[slug], pageErrors: errors.splice(0) }
          console.error(`${device} ${slug}: the page threw ${shots[slug].pageErrors.join(' | ')}`)
        }
      }
      return shots
    })
  }
  writeFileSync(join(outDir, 'index.html'), contactSheet(devices, engines, results))
  const failed = Object.values(results).flatMap((shots) =>
    Object.entries(shots).filter(([, shot]) => shot.error || shot.pageErrors)
  )
  const ran = devices.map((device) => `${device} (${engines[device]})`).join(', ')
  console.log(`Tour of ${STOPS.length} stops on ${ran}: ${relative(repoRoot, join(outDir, 'index.html'))}`)
  if (failed.length > 0) {
    console.error(`${failed.length} stop(s) failed. See the messages above and the contact sheet.`)
    process.exit(1)
  }
}

const escape = (text) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

// One row per stop with the phones side by side, so a reviewer can scan the whole app in one page.
const contactSheet = (devices, engines, results) => `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jimbro tour</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; background: #111; color: #eee; }
  section { margin-bottom: 32px; }
  .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; }
  img { width: 300px; border: 1px solid #333; border-radius: 12px; }
  .error { color: #f87171; max-width: 300px; }
  .skipped { color: #a3a3a3; max-width: 300px; }
</style>
<h1>Jimbro tour</h1>
<p>${escape(new Date().toISOString())} · ${escape(base)}</p>
${STOPS.map(
  ([slug]) => `<section><h2>${escape(slug)}</h2><div class="row">${devices
    .map((device) => {
      const shot = results[device]?.[slug]
      if (!shot) return ''
      const problem = [shot.error, ...(shot.pageErrors ?? [])].filter(Boolean).join(' · ')
      return `<figure><figcaption>${escape(`${device} · ${engines[device]}`)}</figcaption>${
        shot.file ? `<img src="${escape(shot.file)}" alt="${escape(`${slug} on ${device}`)}">` : ''
      }${problem ? `<p class="error">${escape(problem)}</p>` : ''}${
        shot.skipped ? `<p class="skipped">${escape(shot.skipped)}</p>` : ''
      }</figure>`
    })
    .join('')}</div></section>`
).join('\n')}
`

const [cmd, ...args] = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

if (cmd === 'snapshot') {
  if (!args[0] || !args[1]) {
    console.error('drive.mjs snapshot <route> <outDir>')
    process.exit(1)
  }
  await snapshot(args[0], args[1])
} else if (cmd === 'tour') {
  if (!artifactsRoot) {
    console.error('JIMBRO_ARTIFACTS_DIR is not set')
    process.exit(1)
  }
  const device = flag('--device')
  if (device && !DEVICES[device]) {
    console.error(`--device must be one of ${Object.keys(DEVICES).join(', ')}`)
    process.exit(1)
  }
  await tour(device ? [device] : Object.keys(DEVICES), flag('--only'))
} else {
  console.error('Usage: drive.mjs snapshot <route> <outDir> | drive.mjs tour [--device <name>] [--only <slug part>]')
  process.exit(1)
}
