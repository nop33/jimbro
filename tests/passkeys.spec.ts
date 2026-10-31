import { expect, type BrowserContext, type Page } from '@playwright/test'
import { test } from './fixtures'
import type { CDPSession } from '@playwright/test'
import type { ExerciseSnapshot, SetRow } from '../src/db/types'
import { API_BASE } from './localWorker'
import { seedDatabase } from './seed'

// Passkey sign-up, sign-in and the gymtime offer, against the real local worker. Chromium's virtual authenticator
// (WebAuthn over CDP) stands in for the phone's password manager. WebKit has no virtual authenticator, so the tests that
// make or use a passkey run on Chromium only. The offer's "Not now" needs no authenticator and runs everywhere.

// Push day from src/db/stores/seed-programs.json.
const PUSH_DAY_PROGRAM_ID = '07c50b23-d3ad-4c30-a4a9-d8bdf58a2300'

interface Credentials {
  userId: string
  token: string
  method?: string
}

const authenticatorOn = async (page: Page) => {
  const cdp: CDPSession = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  })
  return { cdp, authenticatorId }
}

const credentialsOf = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('jimbro.cloudBackup')
    return raw ? (JSON.parse(raw) as Credentials) : null
  })

const pullAll = async (token: string) => {
  const rows: Array<{ table: string; row: { id: string } }> = []
  let cursor = 0
  for (;;) {
    const response = await fetch(`${API_BASE}/api/pull?cursor=${cursor}&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error(`pull ${response.status} ${await response.text()}`)
    const page = (await response.json()) as { rows: typeof rows; cursor: number; more: boolean }
    rows.push(...page.rows)
    if (!page.more || page.rows.length === 0) return rows
    cursor = page.cursor
  }
}

const tablesOf = (rows: Array<{ table: string }>) =>
  rows.reduce<Record<string, number>>((counts, { table }) => ({ ...counts, [table]: (counts[table] ?? 0) + 1 }), {})

const countLocal = (page: Page, store: string) =>
  page.evaluate(async (name) => {
    const { storage } = await import('/src/db/storage.ts')
    return storage.count(name)
  }, store)

const assertLocalWorker = async (page: Page) => {
  const base = await page.evaluate(async () => (await import('/src/sync/server.ts')).API_BASE as string)
  expect(base, 'The app must talk to the local worker. Stop any dev server of your own so Playwright starts one.').toBe(
    API_BASE
  )
}

const openCloudBackup = async (page: Page) => {
  await page.goto('/settings/')
  await page.locator('#cloud-backup-details > summary').click()
}

// Stores a Push day workout dated today with every set logged but the last exercise's last one, and opens it.
const openAlmostDoneWorkout = async (page: Page) => {
  const sessionId = await page.evaluate(async (programId) => {
    const { storage } = await import('/src/db/storage.ts')
    const { getSimpleDate } = await import('/src/dateUtils.ts')
    const { programsStore } = await import('/src/db/stores/programsStore.ts')
    const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
    const { snapshotFromExercise } = await import('/src/db/stores/workoutSessionsStore.ts')
    const program = await programsStore.getById(programId)
    if (!program) throw new Error('Push day is missing')
    const exercises: Array<ExerciseSnapshot & { sets: Array<SetRow['set']> }> = []
    for (const exerciseId of program.exercises) {
      const exercise = await exercisesStore.getById(exerciseId)
      if (!exercise) throw new Error(`Exercise ${exerciseId} is missing`)
      const set = { preset: 'lifting' as const, reps: exercise.defaults.reps ?? 8, weight: 50 }
      exercises.push({
        ...snapshotFromExercise(exercise),
        sets: Array.from({ length: exercise.targetSets }, () => set)
      })
    }
    exercises[exercises.length - 1].sets.pop()
    const id = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    await storage.writeRows([
      {
        table: 'sessions',
        row: {
          id,
          date: getSimpleDate(new Date()),
          programId,
          location: '',
          status: 'incomplete',
          notes: '',
          exercises: exercises.map(({ sets: _sets, ...snapshot }) => snapshot),
          isDeleted: false,
          updatedAt
        }
      },
      ...exercises.flatMap(({ exerciseId, sets }) =>
        sets.map((set, position) => ({
          table: 'sets' as const,
          row: {
            id: `${id}:${exerciseId}:${position}`,
            sessionId: id,
            exerciseId,
            position,
            set,
            isDeleted: false,
            updatedAt
          }
        }))
      )
    ])
    return { id, lastExerciseId: exercises[exercises.length - 1].exerciseId }
  }, PUSH_DAY_PROGRAM_ID)
  await page.goto(`/gymtime/?id=${sessionId.id}`)
  const lastCard = page.locator(`[data-exercise-id="${sessionId.lastExerciseId}"]`)
  await lastCard.scrollIntoViewIfNeeded()
  await lastCard.locator('.exercise-details > summary').click()
  return { sessionId: sessionId.id, lastCard }
}

// Logs the card's next set, which finishes the workout.
const finishWorkout = async (page: Page, card: ReturnType<Page['locator']>, download: boolean) => {
  // Without cloud backup a finished workout downloads a JSON export. Waiting for it keeps WebKit's next navigation
  // from stalling.
  const exported = download ? page.waitForEvent('download') : undefined
  await card.getByRole('button', { name: 'Finished set' }).click()
  await expect(card.locator('.completed-sets .set.isPending')).toHaveCount(0)
  await exported
}

test.describe('passkeys with a virtual authenticator', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium has a virtual authenticator, over CDP.')

  test('creates a passkey in Settings, backs up, and restores on a new phone', async ({ page, browser }) => {
    const { cdp, authenticatorId } = await authenticatorOn(page)
    await seedDatabase(page)
    await assertLocalWorker(page)

    // Opening the section fetches the options, so the tap goes straight to the passkey sheet, as Safari needs.
    const prefetched = page.waitForResponse((response) => response.url().endsWith('/auth/register/options'))
    await openCloudBackup(page)
    await prefetched
    const fetchedOnTap: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/auth/register/options')) fetchedOnTap.push(request.url())
    })
    await expect(page.locator('#cloud-summary-status')).toHaveText('Not set up yet')
    await expect(page.getByRole('heading', { name: 'Back up your workouts' })).toBeVisible()
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.locator('.toast-message-popup').first()).toHaveText('Passkey created.')
    expect(fetchedOnTap).toEqual([])
    await expect(page.locator('#cloud-summary-status')).toHaveText(/^0 pending · /)
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create passkey' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Add another passkey' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(page.getByText('Use a token')).toBeHidden()

    const created = await credentialsOf(page)
    expect(created?.method).toBe('passkey')
    expect(tablesOf(await pullAll(created?.token ?? ''))).toEqual({ exercises: 21, programs: 3 })

    // The phone's password manager brings the passkey to the new phone.
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
    expect(credentials).toHaveLength(1)
    expect(credentials[0].isResidentCredential).toBe(true)

    const newPhone: BrowserContext = await browser.newContext()
    try {
      const restoring = await newPhone.newPage()
      const authenticator = await authenticatorOn(restoring)
      await authenticator.cdp.send('WebAuthn.addCredential', {
        authenticatorId: authenticator.authenticatorId,
        credential: credentials[0]
      })
      await restoring.goto('/workouts/')
      await expect(restoring.getByRole('button', { name: 'Seed Database' })).toBeVisible()
      // The sign-in downloads the account once, for the comparison and the restore alike.
      const fullPulls: string[] = []
      restoring.on('request', (request) => {
        if (request.url().includes('/api/pull?cursor=0')) fullPulls.push(request.url())
      })
      // The old phone still backs up to the account, so the sign-in asks before it moves the backup here.
      const moving = restoring.waitForEvent('dialog')
      const reloaded = restoring.waitForEvent('framenavigated')
      await restoring.getByRole('button', { name: 'Sign in with passkey' }).click()
      const move = await moving
      expect(move.message()).toContain('Your account is signed in on another device.')
      expect(move.message()).not.toContain("replace this device's copy")
      await move.accept()
      await reloaded
      await expect(restoring.locator('.workout-week').first()).toBeVisible()
      await expect(restoring.getByRole('button', { name: 'Seed Database' })).toHaveCount(0)
      expect(await countLocal(restoring, 'exercises')).toBe(21)
      expect(await countLocal(restoring, 'programs')).toBe(3)
      expect(fullPulls).toHaveLength(1)

      const signedIn = await credentialsOf(restoring)
      expect(signedIn?.userId).toBe(created?.userId)
      expect(signedIn?.method).toBe('passkey')
      expect(signedIn?.token).not.toBe(created?.token)
    } finally {
      await newPhone.close()
    }

    // The old phone's next push finds the backup moved: it stops syncing, keeps its workouts and says so.
    await page.goto('/exercises/')
    await page.evaluate(async () => {
      const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
      await exercisesStore.load()
      const [first] = exercisesStore.all
      await exercisesStore.update({ ...first, name: 'Renamed on the old phone' })
    })
    await expect(
      page.locator('.toast-message-popup', { hasText: 'Your backup moved to another device.' })
    ).toBeVisible()
    expect(await credentialsOf(page)).toBeNull()
    expect(await countLocal(page, 'exercises')).toBe(21)
    await openCloudBackup(page)
    await expect(page.locator('#cloud-summary-status')).toHaveText('Moved to another device')
    await expect(page.getByText('Your backup moved to another device, so this phone stopped backing up.')).toBeVisible()
    await expect(page.locator('#passkey-offer button').first()).toHaveText('Sign in with passkey')
  })

  test('keeps the other phone backing up when the move is declined', async ({ page, browser }) => {
    const { cdp, authenticatorId } = await authenticatorOn(page)
    await seedDatabase(page)
    await assertLocalWorker(page)
    await openCloudBackup(page)
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    const created = await credentialsOf(page)
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })

    const laptop = await browser.newContext()
    try {
      const signingIn = await laptop.newPage()
      const authenticator = await authenticatorOn(signingIn)
      await authenticator.cdp.send('WebAuthn.addCredential', {
        authenticatorId: authenticator.authenticatorId,
        credential: credentials[0]
      })
      await openCloudBackup(signingIn)
      const asked = signingIn.waitForEvent('dialog')
      await signingIn.getByRole('button', { name: 'Sign in with passkey' }).click()
      const move = await asked
      expect(move.message()).toContain('signing in here moves your backup to this device')
      await move.dismiss()
      await expect(signingIn.getByRole('button', { name: 'Sign in with passkey' })).toBeEnabled()
      expect(await credentialsOf(signingIn)).toBeNull()
    } finally {
      await laptop.close()
    }

    const ping = await fetch(`${API_BASE}/api/ping`, { headers: { Authorization: `Bearer ${created?.token}` } })
    expect(ping.status).toBe(200)
  })

  test('makes a new account for a device that synced with a token, and pushes it every row', async ({ page }) => {
    await authenticatorOn(page)
    await seedDatabase(page)
    await assertLocalWorker(page)
    const { claimUser } = await import('./localWorker')
    const user = claimUser()
    await page.evaluate((credentials) => {
      localStorage.setItem('jimbro.cloudBackup', JSON.stringify(credentials))
    }, user)
    await page.evaluate(async () => (await import('/src/sync/syncClient.ts')).sync())
    const tokenAccount = await pullAll(user.token)
    expect(tablesOf(tokenAccount)).toEqual({ exercises: 21, programs: 3 })

    await openCloudBackup(page)
    // A token user gets the offer too, and keeps Sync now.
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    await expect(page.locator('#cloud-summary-status')).toHaveText(/^0 pending · /)

    const created = await credentialsOf(page)
    expect(created?.method).toBe('passkey')
    expect(created?.userId).not.toBe(user.userId)
    // The new account holds the same rows the token account got from this device.
    const keysOf = (rows: Array<{ table: string; row: { id: string } }>) =>
      rows.map(({ table, row }) => `${table}:${row.id}`).sort()
    expect(keysOf(await pullAll(created?.token ?? ''))).toEqual(keysOf(tokenAccount))
  })

  test('adds another passkey and signs out', async ({ page }) => {
    const { cdp, authenticatorId } = await authenticatorOn(page)
    await page.goto('/settings/')
    await assertLocalWorker(page)
    await page.locator('#cloud-backup-details > summary').click()
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    const created = await credentialsOf(page)

    // The authenticator holds one passkey for the account, so a second one has to come from another authenticator.
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false })
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    const other = await authenticatorOn(page)
    await page.getByRole('button', { name: 'Add another passkey' }).click()
    await expect(page.locator('.toast-message-popup', { hasText: 'Passkey added.' })).toBeVisible()
    const { credentials } = await other.cdp.send('WebAuthn.getCredentials', { authenticatorId: other.authenticatorId })
    expect(credentials).toHaveLength(1)

    // A change that cannot back up first makes sign-out warn, and staying keeps the account. Refusing the push, rather
    // than going offline, fails it at once: a request cut off on its way never answers and would hold up the sync.
    await expect(page.locator('#cloud-summary-status')).toHaveText(/^0 pending · /)
    await page.route('**/api/push', (route) => route.abort('internetdisconnected'))
    await page.evaluate(async () => {
      const { storage } = await import('/src/db/storage.ts')
      await storage.writeRows([
        {
          table: 'exercises',
          row: {
            id: 'offline-exercise',
            name: 'Offline squat',
            kind: 'lifting',
            preset: 'lifting',
            muscle: 'quads',
            targetSets: 3,
            defaults: { reps: 5 },
            isDeleted: false,
            updatedAt: new Date().toISOString()
          }
        }
      ])
    })
    const warning = page.waitForEvent('dialog')
    await page.getByRole('button', { name: 'Sign out' }).click()
    const warned = await warning
    expect(warned.message()).toContain("1 change on this phone hasn't backed up yet")
    await warned.dismiss()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    expect((await credentialsOf(page))?.method).toBe('passkey')

    // With the push back, sign-out pushes the change first, and asks plainly.
    await page.unroute('**/api/push')
    const asked = page.waitForEvent('dialog')
    await page.getByRole('button', { name: 'Sign out' }).click()
    const plain = await asked
    expect(plain.message()).toBe('Sign out? Your workouts stay on this phone, and stop backing up.')
    expect((await pullAll(created?.token ?? '')).some((row) => row.row.id === 'offline-exercise')).toBe(true)
    await plain.accept()
    await expect(page.locator('.toast-message-popup', { hasText: 'Signed out.' })).toBeVisible()
    await expect(page.locator('#cloud-summary-status')).toHaveText('Not set up yet')
    // A phone that signed out offers signing in first.
    const offerButtons = page.locator('#passkey-offer button')
    await expect(offerButtons.first()).toHaveText('Sign in with passkey')
    await expect(offerButtons.first()).toHaveClass(/btn-primary/)
    await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveClass(/btn-secondary/)
    expect(await credentialsOf(page)).toBeNull()
    const ping = await fetch(`${API_BASE}/api/ping`, { headers: { Authorization: `Bearer ${created?.token}` } })
    expect(ping.status).toBe(401)

    // Everything here backed up before the sign-out, so signing in again replaces nothing and asks nothing.
    const asksAgain: string[] = []
    page.on('dialog', (dialog) => {
      asksAgain.push(dialog.message())
      void dialog.dismiss()
    })
    // While the account downloads, the button says it is signing in and takes no more taps.
    let releasePull = () => {}
    const pullHeld = new Promise<void>((resolve) => (releasePull = resolve))
    await page.route('**/api/pull**', async (route) => {
      await pullHeld
      await route.continue()
    })
    await page.getByRole('button', { name: 'Sign in with passkey' }).click()
    const busy = page.getByRole('button', { name: 'Signing in…' })
    await expect(busy).toHaveAttribute('aria-busy', 'true')
    await expect(busy).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Create passkey' })).toBeDisabled()
    releasePull()
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    expect(asksAgain).toEqual([])
    expect((await credentialsOf(page))?.userId).toBe(created?.userId)
  })

  test('asks before signing in over a phone with data, and keeps the rows only on the phone', async ({
    page,
    browser
  }) => {
    const { cdp, authenticatorId } = await authenticatorOn(page)
    await seedDatabase(page)
    await assertLocalWorker(page)
    await openCloudBackup(page)
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    const created = await credentialsOf(page)
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })

    const otherPhone = await browser.newContext()
    try {
      const phone = await otherPhone.newPage()
      const authenticator = await authenticatorOn(phone)
      await authenticator.cdp.send('WebAuthn.addCredential', {
        authenticatorId: authenticator.authenticatorId,
        credential: credentials[0]
      })
      await seedDatabase(phone)
      await phone.evaluate(async () => {
        const { storage } = await import('/src/db/storage.ts')
        await storage.writeRows([
          {
            table: 'exercises',
            row: {
              id: 'phone-only',
              name: 'Phone only',
              kind: 'lifting',
              preset: 'lifting',
              muscle: 'quads',
              targetSets: 3,
              defaults: { reps: 5 },
              isDeleted: false,
              updatedAt: new Date().toISOString()
            }
          }
        ])
      })
      await openCloudBackup(phone)

      // Saying no leaves the phone as it was.
      const first = phone.waitForEvent('dialog')
      await phone.getByRole('button', { name: 'Sign in with passkey' }).click()
      const declined = await first
      expect(declined.message()).toContain("signing in will replace this device's copy with your account's")
      await declined.dismiss()
      await expect(phone.getByRole('button', { name: 'Sign in with passkey' })).toBeEnabled()
      expect(await credentialsOf(phone)).toBeNull()

      phone.once('dialog', (dialog) => dialog.accept())
      await phone.getByRole('button', { name: 'Sign in with passkey' }).click()
      await expect(phone.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
      await expect(phone.locator('#cloud-summary-status')).toHaveText(/^0 pending · /)
      const signedIn = await credentialsOf(phone)
      expect(signedIn?.userId).toBe(created?.userId)
      const rows = await pullAll(signedIn?.token ?? '')
      expect(rows.some((row) => row.row.id === 'phone-only')).toBe(true)
      expect(tablesOf(rows)).toEqual({ exercises: 22, programs: 3 })
    } finally {
      await otherPhone.close()
    }
  })

  test('signs in from the gymtime offer and loads the page again', async ({ page }) => {
    await authenticatorOn(page)
    await seedDatabase(page)
    await assertLocalWorker(page)
    await openCloudBackup(page)
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.getByText('Your workouts are backed up with a passkey.')).toBeVisible()
    const created = await credentialsOf(page)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.locator('.toast-message-popup', { hasText: 'Signed out.' })).toBeVisible()

    const { lastCard } = await openAlmostDoneWorkout(page)
    await finishWorkout(page, lastCard, true)
    const offer = page.getByRole('region', { name: 'Back up your workouts' })
    await expect(offer).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    const reloaded = page.waitForEvent('framenavigated')
    await offer.getByRole('button', { name: 'Already have a passkey? Sign in' }).click()
    await reloaded
    await expect(offer).toBeHidden()
    const signedIn = await credentialsOf(page)
    expect(signedIn?.method).toBe('passkey')
    expect(signedIn?.userId).toBe(created?.userId)
  })

  test('offers a passkey after a finished workout, and backs up from the offer', async ({ page }) => {
    await authenticatorOn(page)
    await seedDatabase(page)
    await assertLocalWorker(page)
    const { sessionId, lastCard } = await openAlmostDoneWorkout(page)
    const offer = page.getByRole('region', { name: 'Back up your workouts' })
    await expect(offer).toBeHidden()

    await finishWorkout(page, lastCard, true)
    await expect(offer).toBeVisible()
    await offer.getByRole('button', { name: 'Create passkey' }).click()
    await expect(page.locator('.toast-message-popup', { hasText: 'Passkey created.' })).toBeVisible()
    await expect(offer).toBeHidden()

    const created = await credentialsOf(page)
    expect(created?.method).toBe('passkey')
    await expect
      .poll(async () => (await pullAll(created?.token ?? '')).some((row) => row.row.id === sessionId))
      .toBe(true)
  })
})

test('a finished workout offers a passkey until "Not now", where the browser has passkeys', async ({ page }) => {
  await seedDatabase(page)
  const supported = await page.evaluate(async () => (await import('/src/sync/passkeys.ts')).passkeysSupported())
  const { lastCard } = await openAlmostDoneWorkout(page)
  const offer = page.getByRole('region', { name: 'Back up your workouts' })

  await finishWorkout(page, lastCard, true)
  if (!supported) {
    await expect(offer).toBeHidden()
    return
  }
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name: 'Not now' }).click()
  await expect(offer).toBeHidden()
  const snoozedUntil = await page.evaluate(() => localStorage.getItem('jimbro.passkeyOffer.snoozedUntil'))
  const days = (Date.parse(snoozedUntil ?? '') - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(13.9)
  expect(days).toBeLessThanOrEqual(14)

  // Another set makes the workout incomplete, and finishing it again keeps the offer away. A finished card closes.
  await lastCard.locator('.exercise-details > summary').click()
  await lastCard.getByRole('button', { name: 'Add set' }).click()
  await expect(lastCard.getByRole('button', { name: 'Finished set' })).toBeVisible()
  await finishWorkout(page, lastCard, true)
  await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy', 'true')
  await expect(offer).toBeHidden()
})
