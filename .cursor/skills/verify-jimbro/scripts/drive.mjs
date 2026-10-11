#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const base = process.env.JIMBRO_VERIFY_URL
if (!base) {
  console.error('JIMBRO_VERIFY_URL is not set')
  process.exit(1)
}

const artifactsRoot = process.env.JIMBRO_ARTIFACTS_DIR

// The two phones Jimbro is used on. Chromium stands in for Safari on the iPhone profile, so it
// checks layout and the user path, not WebKit behaviour. The repo's specs cover WebKit on CI.
const DEVICES = {
  iphone13: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  },
  pixel8pro: {
    viewport: { width: 448, height: 998 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
  }
}
const deviceName = process.env.JIMBRO_VERIFY_DEVICE ?? 'iphone13'
const device = DEVICES[deviceName]
if (!device) {
  console.error(`JIMBRO_VERIFY_DEVICE must be one of ${Object.keys(DEVICES).join(', ')}`)
  process.exit(1)
}

// Playwright's own Chromium when it is installed. Otherwise JIMBRO_CHROMIUM, or the image's
// /opt/pw-browsers/chromium in Claude Code cloud sessions, whose build can differ from Playwright's.
function chromiumPath() {
  if (existsSync(chromium.executablePath())) return undefined
  const fallback = process.env.JIMBRO_CHROMIUM ?? '/opt/pw-browsers/chromium'
  if (existsSync(fallback)) return fallback
  throw new Error('No Chromium found. Run `vp exec playwright install chromium` or set JIMBRO_CHROMIUM.')
}

// Every drive gets a fresh context, so IndexedDB starts empty. Page errors fail the drive.
async function withPage(fn) {
  const browser = await chromium.launch({ executablePath: chromiumPath() })
  const context = await browser.newContext({ ...device, baseURL: base })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const result = await fn(page)
    if (errors.length > 0) throw new Error(`The page threw:\n${errors.join('\n')}`)
    return result
  } finally {
    await browser.close()
  }
}

async function capture(page, outDir, stem) {
  mkdirSync(outDir, { recursive: true })
  await page.screenshot({ path: resolve(outDir, `${stem}.png`), fullPage: true })
  const aria = await page.locator('body').ariaSnapshot()
  writeFileSync(resolve(outDir, `${stem}.aria.yml`), aria)
}

function writeProof(outDir, lines) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'proof.txt'), [`device: ${deviceName}`, ...lines].join('\n') + '\n')
}

// Reads the rows a page wrote, as evidence of the side effect. It opens the database without a
// version, so it never upgrades it, and it writes nothing.
const readStores = (page, names) =>
  page.evaluate(
    (names) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('gymbro-database')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction(names, 'readonly')
          const result = {}
          for (const name of names) {
            const read = transaction.objectStore(name).getAll()
            read.onsuccess = () => (result[name] = read.result)
          }
          transaction.oncomplete = () => {
            db.close()
            resolve(result)
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    names
  )

const see = (locator) => locator.first().waitFor({ state: 'visible' })
const gone = (locator) => locator.first().waitFor({ state: 'hidden' })

async function seed(page) {
  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'Seed Database' }).click()
  await see(page.locator('.workout-week'))
}

async function heading(page, text) {
  const title = page.locator('h1.app-header-title', { hasText: text })
  await see(title)
  return (await title.innerText()).trim()
}

async function snapshot(route, outDir) {
  await withPage(async (page) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await see(page.locator('h1.app-header-title'))
    await capture(page, resolve(outDir), 'page')
    writeProof(resolve(outDir), ['feature: snapshot', `url: ${page.url()}`, `entry: GET ${route}`])
    console.log(`Wrote snapshot of ${page.url()} to ${outDir}`)
  })
}

const drives = {
  async home(page, outDir) {
    await page.goto('/')
    const homeHeading = await heading(page, 'Hey, gymbro.')
    await see(page.getByText("Let's set up your first workout."))
    await capture(page, outDir, 'home-empty')

    await page.getByRole('link', { name: 'Get started' }).click()
    await page.waitForURL('**/workouts/')
    const workoutsHeading = await heading(page, 'Workouts')
    await see(page.locator('.nav-link[aria-current="page"][href="/workouts/"]'))

    await page.getByRole('button', { name: 'Seed Database' }).click()
    await see(page.locator('.workout-week'))
    await page.getByRole('link', { name: 'Home' }).click()
    await page.waitForURL(`${base}/`)
    await see(page.locator('.week-day[aria-current="date"]'))
    const suggested = page.locator('.program-pick[data-suggested]')
    await see(suggested)
    const pick = (await suggested.innerText()).replace(/\s+/g, ' ').trim()
    await capture(page, outDir, 'home-seeded')

    await suggested.click()
    await page.waitForURL('**/gymtime/?programId=*')
    await capture(page, outDir, 'gymtime-from-pick')
    return [
      'feature: home',
      'entry: Get started on an empty /, then the suggested program pick after seeding',
      `homeHeading: ${homeHeading}`,
      `workoutsHeading: ${workoutsHeading}`,
      `suggestedPick: ${pick}`,
      `afterPick: ${page.url()}`
    ]
  },

  async workouts(page, outDir) {
    await page.goto('/workouts/')
    await heading(page, 'Workouts')
    await see(page.getByRole('button', { name: 'Seed Database' }))
    await capture(page, outDir, 'empty')

    await page.getByRole('button', { name: 'Seed Database' }).click()
    await see(page.locator('.workout-week'))
    const pending = page.locator('.card-pending')
    await see(pending)
    const pendingBefore = await pending.count()
    await capture(page, outDir, 'seeded')

    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await see(dialog)
    await capture(page, outDir, 'new-dialog')
    await dialog.getByRole('button', { name: 'Close dialog' }).click()
    await gone(dialog)

    await pending.first().click()
    await page.waitForURL('**/gymtime/?programId=*')
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await see(page.locator('.toast-message-popup', { hasText: 'Workout session saved' }))
    await page.goBack()
    await see(page.locator('.card-warning'))
    const pendingAfter = await pending.count()
    if (pendingAfter !== pendingBefore - 1) {
      throw new Error(`Expected ${pendingBefore - 1} pending cards after starting one, saw ${pendingAfter}`)
    }
    await capture(page, outDir, 'after-start')
    return [
      'feature: workouts',
      'entry: /workouts/ on an empty database, then a pending week card',
      `pendingBefore: ${pendingBefore}`,
      `pendingAfter: ${pendingAfter}`
    ]
  },

  async gymtime(page, outDir) {
    await seed(page)
    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('dialog#new-workout-dialog a.program-link').first().click()
    await page.waitForURL('**/gymtime/?programId=*')
    const program = await heading(page, '')

    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await see(page.locator('.toast-message-popup', { hasText: 'Workout session saved' }))
    await page.waitForURL('**/gymtime/?id=*')
    const sessionUrl = page.url()

    const card = page.locator('details.exercise-details').first()
    await card.locator('summary').click()
    const form = card.locator('.next-set-form').first()
    await see(form)
    await form.locator('input[name="set-reps"]').first().fill('10')
    await form.locator('input[name="set-weight"]').first().fill('100')
    await form.getByRole('button', { name: 'Finished set' }).click()

    const breakTimer = page.locator('#break-countdown-dialog')
    await see(breakTimer)
    await capture(page, outDir, 'break-timer')
    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    await gone(breakTimer)

    const logged = card.locator('.completed-sets .set.isCompleted').first()
    await see(logged.filter({ hasText: '100' }))
    await logged.click()
    const editDialog = page.locator('#edit-set-dialog')
    await see(editDialog)
    await editDialog.locator('input[name="set-weight"]').fill('105')
    await editDialog.getByRole('button', { name: 'Save' }).click()
    await gone(editDialog)
    await see(logged.locator('.set-weight', { hasText: '105' }))

    await page.reload()
    const reloaded = page.locator('details.exercise-details').first()
    await reloaded.locator('summary').click()
    await see(reloaded.locator('.completed-sets .set.isCompleted .set-weight', { hasText: '105' }))
    await capture(page, outDir, 'after-reload')

    const sessionId = new URL(sessionUrl).searchParams.get('id')
    const { sets, outbox } = await readStores(page, ['sets', 'outbox'])
    const stored = sets.filter((row) => row.sessionId === sessionId && !row.isDeleted)
    writeFileSync(resolve(outDir, 'db.json'), JSON.stringify({ sessionId, sets: stored }, null, 2) + '\n')
    if (stored.length !== 1 || stored[0].set.weight !== 105 || stored[0].set.reps !== 10) {
      throw new Error(`Expected one stored set of 10 × 105, found ${JSON.stringify(stored)}`)
    }

    await page.goto('/workouts/')
    await see(page.locator('.card-warning'))
    await capture(page, outDir, 'workouts-card')
    return [
      'feature: gymtime',
      'entry: New workout dialog, first program',
      `program: ${program}`,
      `session: ${sessionUrl}`,
      `storedSet: ${stored[0].id} reps=${stored[0].set.reps} weight=${stored[0].set.weight}`,
      `outboxEntries: ${outbox.length} (queued for sync; no credentials, so nothing was sent)`
    ]
  },

  async exercises(page, outDir) {
    await page.goto('/exercises/')
    await heading(page, 'Exercises')
    const dialog = page.locator('dialog#exercise-dialog')
    await page.getByRole('button', { name: 'New' }).click()
    await see(dialog)
    await dialog.getByRole('button', { name: 'Close dialog' }).click()
    await gone(dialog)

    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Bench Press')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Chest' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default reps').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await see(page.locator('.toast-message-popup', { hasText: 'Exercise saved' }))
    const card = page.locator('.card', { hasText: 'Bench Press' })
    await see(card.filter({ hasText: 'Chest' }))

    await page.reload()
    await see(card)
    await card.click()
    await see(dialog)
    await page.getByLabel('Default reps').fill('8')
    await page.getByRole('button', { name: 'Save' }).click()
    await gone(dialog)
    const cardText = (await card.innerText()).replace(/\s+/g, ' ').trim()
    await capture(page, outDir, 'after-edit')

    const filter = page.getByLabel('Filter by muscle group')
    await filter.selectOption({ label: 'Back' })
    await gone(card)
    await filter.selectOption({ label: 'Chest' })
    await see(card)

    await card.click()
    page.once('dialog', (confirm) => void confirm.accept())
    await page.locator('#delete-exercise-btn').click()
    await gone(card)
    await capture(page, outDir, 'after-delete')
    // An empty grid has no empty state to wait for, so the stored row proves the delete.
    const { exercises } = await readStores(page, ['exercises'])
    const row = exercises.find((exercise) => exercise.name === 'Bench Press')
    if (!row?.isDeleted) throw new Error(`Expected Bench Press stored as deleted, found ${JSON.stringify(row)}`)
    return [
      'feature: exercises',
      'entry: New in the /exercises/ header',
      `cardAfterEdit: ${cardText}`,
      `deleted: card gone, row ${row.id} stored with isDeleted: true`
    ]
  },

  async programs(page, outDir) {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Squat')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Quads' })
    await page.getByLabel('Default sets').fill('4')
    await page.getByLabel('Default reps').fill('8')
    await page.getByRole('button', { name: 'Save' }).click()
    await see(page.locator('.toast-message-popup', { hasText: 'Exercise saved' }))

    await page.getByRole('link', { name: 'Programs' }).click()
    await heading(page, 'Programs')
    const dialog = page.locator('dialog#program-dialog')
    await page.getByRole('button', { name: 'New' }).click()
    await see(dialog)
    await page.getByLabel('Name', { exact: true }).fill('Leg Day')
    await page.locator('#exercises-selection').selectOption({ label: 'Squat' })
    await page.getByRole('button', { name: 'Save' }).click()
    const card = page.locator('#programs-grid > .card', { hasText: 'Leg Day' })
    await see(card.filter({ hasText: 'Squat' }))

    await page.reload()
    await see(card.filter({ hasText: 'Squat' }))
    await card.locator('.edit-program-btn').click()
    await see(dialog)
    await page.getByLabel('Name', { exact: true }).fill('Mega Leg Day')
    await page.getByRole('button', { name: 'Save' }).click()
    await see(card.filter({ hasText: 'Mega Leg Day' }))
    await capture(page, outDir, 'after-edit')

    await card.locator('.edit-program-btn').click()
    await see(dialog)
    page.once('dialog', (confirm) => void confirm.accept())
    await page.locator('#delete-program-btn').click()
    await gone(card)
    await capture(page, outDir, 'after-delete')
    return ['feature: programs', 'entry: New in the /programs/ header, after creating Squat', 'renamed: Mega Leg Day']
  }
}

const [cmd, a, b] = process.argv.slice(2)

if (cmd === 'snapshot') {
  if (!a || !b) {
    console.error('drive.mjs snapshot <route> <outDir>')
    process.exit(1)
  }
  await snapshot(a, b)
} else if (cmd === 'drive' && (a in drives || a === 'all')) {
  if (!artifactsRoot) {
    console.error('JIMBRO_ARTIFACTS_DIR is not set')
    process.exit(1)
  }
  for (const feature of a === 'all' ? Object.keys(drives) : [a]) {
    const outDir = resolve(artifactsRoot, deviceName, feature)
    const lines = await withPage((page) => drives[feature](page, outDir))
    writeProof(outDir, [`url: ${base}`, ...lines])
    console.log(`${feature} proved on ${deviceName}. Artifacts in ${outDir}`)
  }
} else {
  console.error(`Usage: drive.mjs snapshot <route> <outDir> | drive.mjs drive <${Object.keys(drives).join('|')}|all>`)
  process.exit(1)
}
