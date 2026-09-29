import { expect, test, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test'

const USER = { userId: 'gymtime-sync', token: 'gymtime-sync-token' }

// A rebuild starts from the pull and lands just after jimbro:sync-settled, so give it time to show up.
const REBUILD_GRACE_MS = 1000

interface WireRow {
  table: string
  row: { id: string } & Record<string, unknown>
}

interface StoredRow extends WireRow {
  rev: number
  data: string
}

// Mirrors worker/src/rows.ts: a changed row gets a revision above every stored one and an unchanged row
// keeps its own, push answers the highest revision, and pull pages the rows above the cursor in revision order.
// Routes match on the path alone, so the spec never reaches a real worker, whatever VITE_API_BASE says.
const fakeWorker = async (context: BrowserContext) => {
  const rows = new Map<string, StoredRow>()
  let held: { arrived: () => void; gate: Promise<void> } | null = null
  const highest = () => Math.max(0, ...[...rows.values()].map((stored) => stored.rev))

  const reply = (route: Route, status: number, body?: unknown) => {
    const origin = route.request().headers()['origin'] ?? '*'
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: body === undefined ? '' : JSON.stringify(body)
    })
  }

  const handle = (serve: (route: Route) => Promise<void>) => async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return reply(route, 204)
    if (request.headers()['authorization'] !== `Bearer ${USER.token}`)
      return reply(route, 401, { error: 'unauthorized' })
    return serve(route)
  }

  await context.route(
    (url) => url.pathname === '/api/push',
    handle(async (route) => {
      if (held) {
        held.arrived()
        await held.gate
      }
      const pushed = (route.request().postDataJSON() as { rows: WireRow[] }).rows
      const base = highest()
      pushed.forEach(({ table, row }, index) => {
        const key = `${table}:${row.id}`
        const data = JSON.stringify(row)
        const current = rows.get(key)
        rows.set(key, { table, row, data, rev: current?.data === data ? current.rev : base + index + 1 })
      })
      await reply(route, 200, { revision: highest() })
    })
  )

  await context.route(
    (url) => url.pathname === '/api/pull',
    handle(async (route) => {
      const params = new URL(route.request().url()).searchParams
      const cursor = Number(params.get('cursor') ?? 0)
      const limit = Math.min(Number(params.get('limit') ?? 1000), 1000)
      const above = [...rows.values()]
        .filter((stored) => stored.rev > cursor)
        .sort((left, right) => left.rev - right.rev)
      const page = above.slice(0, limit)
      await reply(route, 200, {
        rows: page.map(({ table, data, rev }) => ({ table, row: JSON.parse(data) as unknown, rev })),
        cursor: page.at(-1)?.rev ?? cursor,
        more: above.length > limit,
        ...(cursor === 0 ? { importedExportDate: null } : {})
      })
    })
  )

  return {
    rows: (table: string) => [...rows.values()].filter((stored) => stored.table === table).map(({ row }) => row),
    // Stands in for a change that reached the server from somewhere else.
    edit: (table: string, id: string, change: (row: StoredRow['row']) => StoredRow['row']) => {
      const current = rows.get(`${table}:${id}`)
      if (!current) throw new Error(`the fake worker has no ${table} row ${id}`)
      const row = change(JSON.parse(current.data) as StoredRow['row'])
      rows.set(`${table}:${id}`, { table, row, data: JSON.stringify(row), rev: highest() + 1 })
    },
    // Keeps the next pushes waiting, the way a slow connection would, until release().
    holdPushes: () => {
      let arrived = () => {}
      let open = () => {}
      const reached = new Promise<void>((resolve) => {
        arrived = resolve
      })
      held = {
        arrived,
        gate: new Promise<void>((resolve) => {
          open = resolve
        })
      }
      return {
        reached,
        release: () => {
          held = null
          open()
        }
      }
    }
  }
}

const recordSyncEvents = (context: BrowserContext) =>
  context.addInitScript(() => {
    const events: string[] = []
    Reflect.set(window, '__syncEvents', events)
    window.addEventListener('jimbro:rows-written', () => events.push('written'))
    window.addEventListener('jimbro:sync-settled', () => events.push('settled'))
    window.addEventListener('jimbro:open-session-pulled', () => events.push('announced'))
  })

const recordStorePuts = (context: BrowserContext) =>
  context.addInitScript(() => {
    const stores: string[] = []
    Reflect.set(window, '__storePuts', stores)
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      stores.push(this.name)
      return put.apply(this, args)
    }
  })

const syncActivityMark = (page: Page) =>
  page.evaluate(() => ({
    events: (Reflect.get(window, '__syncEvents') as string[]).length,
    puts: (Reflect.get(window, '__storePuts') as string[]).length
  }))

// The object stores written and the open-session announcements since the mark.
const syncActivitySince = (page: Page, mark: Awaited<ReturnType<typeof syncActivityMark>>) =>
  page.evaluate(({ events, puts }) => {
    const stores = (Reflect.get(window, '__storePuts') as string[]).slice(puts)
    const announced = (Reflect.get(window, '__syncEvents') as string[]).slice(events)
    return {
      stores: [...new Set(stores)].sort(),
      announced: announced.filter((event) => event === 'announced').length
    }
  }, mark)

const syncSettledOnLoad = (page: Page) =>
  page.waitForFunction(() => (Reflect.get(window, '__syncEvents') as string[]).includes('settled'))

// Resolves once a sync settled after this page's latest write.
const syncSettledAfterWrite = (page: Page) =>
  page.waitForFunction(() => {
    const events = Reflect.get(window, '__syncEvents') as string[]
    const written = events.lastIndexOf('written')
    return written >= 0 && events.lastIndexOf('settled') > written
  })

const startSyncedWorkout = async (page: Page) => {
  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'Seed Database' }).click()
  await expect(page.locator('.workout-week').first()).toBeVisible()

  await page.goto('/settings/')
  await page.getByText('Cloud Backup').click()
  await page.getByLabel('User ID').fill(USER.userId)
  await page.getByLabel('Token').fill(USER.token)
  await page.getByRole('button', { name: 'Save credentials' }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.locator('#cloud-summary-status')).toContainText('0 pending ·')

  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)
  await syncSettledOnLoad(page)
  await page.getByRole('button', { name: 'Save & start workout' }).click()
  await expect(page).toHaveURL(/\/gymtime\/\?id=.+/)
  await syncSettledAfterWrite(page)
}

const firstCard = (page: Page) => page.locator('#exercises-list > .card').first()

const logSet = async (page: Page, card: Locator, { reps, weight }: { reps: string; weight: string }) => {
  await card.locator('.exercise-details > summary').click()
  const form = card.locator('.next-set-form')
  await form.locator('input[name="set-reps"]').fill(reps)
  await form.locator('input[name="set-weight"]').fill(weight)
  await form.getByRole('button', { name: 'Finished set' }).click()
  const breakTimer = page.locator('#break-countdown-dialog')
  await expect(breakTimer).toBeVisible()
  await breakTimer.getByRole('button', { name: 'Skip' }).click()
  await expect(breakTimer).toBeHidden()
}

// Keeps a handle on every card so a later check can tell whether the list was rebuilt.
const cardNodes = (page: Page) => page.locator('#exercises-list > .card').elementHandles()

const sameCardNodes = (page: Page, before: Awaited<ReturnType<typeof cardNodes>>) =>
  page.evaluate((nodes) => {
    const now = [...document.querySelectorAll('#exercises-list > .card')]
    return now.length === nodes.length && now.every((node, index) => node === nodes[index])
  }, before)

test.describe('gymtime with cloud sync', () => {
  test.beforeEach(async ({ context }) => {
    await recordSyncEvents(context)
  })

  test('a synced set keeps the extra slot, the typed reps and the cards', async ({ page, context }) => {
    const worker = await fakeWorker(context)
    await startSyncedWorkout(page)
    const card = firstCard(page)
    const push = worker.holdPushes()
    await logSet(page, card, { reps: '10', weight: '100' })

    await card.getByRole('button', { name: 'Add set' }).click()
    const slots = card.locator('.completed-sets .set')
    const slotCount = await slots.count()
    const nextReps = card.locator('.next-set-form input[name="set-reps"]')
    await nextReps.fill('7')
    const before = await cardNodes(page)

    await push.reached
    push.release()
    await syncSettledAfterWrite(page)
    await page.waitForTimeout(REBUILD_GRACE_MS)

    expect(worker.rows('sets')).toHaveLength(1)
    await expect(slots).toHaveCount(slotCount)
    await expect(slots.last()).toHaveAttribute('data-set-number', String(slotCount))
    await expect(nextReps).toHaveValue('7')
    expect(await sameCardNodes(page, before)).toBe(true)
  })

  test('an echoed pull rewrites no row and announces nothing, a changed pull does both', async ({ page, context }) => {
    await recordStorePuts(context)
    const worker = await fakeWorker(context)
    await startSyncedWorkout(page)
    const push = worker.holdPushes()
    await logSet(page, firstCard(page), { reps: '10', weight: '100' })
    await push.reached
    const echo = await syncActivityMark(page)
    push.release()
    await syncSettledAfterWrite(page)

    expect(await syncActivitySince(page, echo)).toEqual({ stores: ['meta'], announced: 0 })

    const [set] = worker.rows('sets')
    worker.edit('sets', set.id, (row) => ({ ...row, updatedAt: new Date().toISOString() }))
    const change = await syncActivityMark(page)
    await context.setOffline(true)
    await context.setOffline(false)

    await expect
      .poll(() => syncActivitySince(page, change))
      .toEqual({ stores: ['meta', 'setGroups', 'sets'], announced: 1 })
  })

  test('a set changed on the server refreshes the open session', async ({ page, context }) => {
    const worker = await fakeWorker(context)
    await startSyncedWorkout(page)
    const card = firstCard(page)
    await logSet(page, card, { reps: '10', weight: '100' })
    await syncSettledAfterWrite(page)
    const loggedWeight = card.locator('.completed-sets .set.isCompleted .set-weight')
    await expect(loggedWeight).toHaveText('100')

    const [set] = worker.rows('sets')
    worker.edit('sets', set.id, (row) => ({
      ...row,
      set: { ...(row.set as Record<string, unknown>), weight: 105 },
      updatedAt: new Date().toISOString()
    }))
    // Coming back online is one of the moments the app pulls.
    await context.setOffline(true)
    await context.setOffline(false)

    await expect(loggedWeight).toHaveText('105')
  })

  test('a set logged in another tab shows up in this one', async ({ page, context }) => {
    await fakeWorker(context)
    await startSyncedWorkout(page)
    const other = await context.newPage()
    await other.goto(page.url())
    await syncSettledOnLoad(other)

    await logSet(other, firstCard(other), { reps: '11', weight: '50' })

    const logged = firstCard(page).locator('.completed-sets .set.isCompleted')
    await expect(logged).toHaveCount(1)
    await expect(logged.locator('.set-reps')).toHaveText('11')
  })

  test('another tab syncing leaves this tab mid-set alone', async ({ page, context }) => {
    await fakeWorker(context)
    await startSyncedWorkout(page)
    const card = firstCard(page)
    await logSet(page, card, { reps: '10', weight: '100' })
    await card.getByRole('button', { name: 'Add set' }).click()
    const slots = card.locator('.completed-sets .set')
    const slotCount = await slots.count()
    const nextReps = card.locator('.next-set-form input[name="set-reps"]')
    await nextReps.fill('7')
    const before = await cardNodes(page)

    const settings = await context.newPage()
    await settings.goto('/settings/')
    await settings.getByText('Cloud Backup').click()
    await settings.getByRole('button', { name: 'Sync now' }).click()
    await expect(settings.locator('#cloud-summary-status')).toContainText('0 pending ·')
    await syncSettledAfterWrite(page)
    await page.waitForTimeout(REBUILD_GRACE_MS)

    await expect(slots).toHaveCount(slotCount)
    await expect(nextReps).toHaveValue('7')
    expect(await sameCardNodes(page, before)).toBe(true)
  })
})
