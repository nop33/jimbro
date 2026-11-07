import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import type { CDPSession } from '@playwright/test'
import { API_BASE } from './localWorker'
import { seedDatabase } from './seed'

// An AI assistant connecting over OAuth, against the real local worker: the worker sends the browser to /connect/,
// the user approves with a passkey, and the browser goes back to the assistant with a code. Settings lists the
// connection and disconnects it. Chromium's virtual authenticator stands in for the phone's password manager, so the
// tests run on Chromium only.

// Where the assistant gets the browser back. The tests answer it themselves.
const REDIRECT = 'https://assistant.example/callback'

const authenticatorOn = async (page: Page) => {
  const cdp: CDPSession = await page.context().newCDPSession(page)
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
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

// What an assistant does before it opens the browser: registers, and makes a PKCE pair.
const prepareAssistant = async () => {
  const registered = await fetch(`${API_BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] })
  })
  expect(registered.status).toBe(201)
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const authorizeUrl = `${API_BASE}/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: `${API_BASE}/mcp`
  }).toString()}`
  return { clientId, verifier, authorizeUrl }
}

const exchange = async (clientId: string, code: string, verifier: string) => {
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
      resource: `${API_BASE}/mcp`
    }).toString()
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { access_token: string }).access_token
}

const callMcp = (token: string) =>
  fetch(`${API_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'catalog', arguments: {} } })
  })

const savedToken = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('jimbro.cloudBackup')
    return raw ? (JSON.parse(raw) as { token: string }).token : null
  })

// Signs up with a passkey in Settings, which backs the sample data up.
const createPasskey = async (page: Page) => {
  await page.goto('/settings/backup/')
  await page.getByRole('button', { name: 'Create passkey' }).click()
  await expect(page.locator('#cloud-summary-status')).toHaveText(/^0 pending · /)
}

const openAssistants = async (page: Page) => {
  await page.goto('/settings/assistants/')
}

test.describe('connecting an AI assistant', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium has a virtual authenticator, over CDP.')

  test.beforeEach(async ({ page }) => {
    await page.route('https://assistant.example/**', (route) => route.fulfill({ body: 'Back at the assistant' }))
    await authenticatorOn(page)
    await page.goto('/settings/')
    await seedDatabase(page)
  })

  test('asks for a passkey backup before showing the prompt', async ({ page }) => {
    await openAssistants(page)
    await expect(page.getByText('An assistant signs in with your passkey')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeHidden()
  })

  test('connects with a passkey, reads the backup, and disconnects from Settings', async ({ page }) => {
    await createPasskey(page)
    const deviceToken = await savedToken(page)

    await openAssistants(page)
    // The prompt names the link, for any assistant to connect with.
    expect(await page.getByLabel('Prompt').inputValue()).toContain(` ${API_BASE}/mcp `)
    await expect(page.getByText('No assistant is connected yet.')).toBeVisible()

    const assistant = await prepareAssistant()
    const prefetched = page.waitForResponse((response) => response.url().endsWith('/auth/connect/options'))
    await page.goto(assistant.authorizeUrl)
    await expect(page).toHaveURL(/\/connect\/\?request=/)
    await expect(page.getByRole('heading', { name: 'Allow Claude to read your workouts?' })).toBeVisible()
    await expect(page.locator('#connect-host')).toHaveText('assistant.example')
    await prefetched

    await page.getByRole('button', { name: 'Allow with passkey' }).click()
    await page.waitForURL(/^https:\/\/assistant\.example\/callback/)
    const back = new URL(page.url())
    expect(back.searchParams.get('state')).toBe('state-1')
    const token = await exchange(assistant.clientId, back.searchParams.get('code') ?? '', assistant.verifier)
    const read = await callMcp(token)
    expect(read.status).toBe(200)
    const catalog = (await read.json()) as { result: { structuredContent: { exercises: unknown[] } } }
    expect(catalog.result.structuredContent.exercises).toHaveLength(21)

    // The phone keeps backing up with its own sign-in.
    await openAssistants(page)
    expect(await savedToken(page)).toBe(deviceToken)
    const ping = await fetch(`${API_BASE}/api/ping`, { headers: { Authorization: `Bearer ${deviceToken}` } })
    expect(ping.status).toBe(200)

    const item = page.getByRole('listitem').filter({ hasText: 'Claude' })
    await expect(item).toBeVisible()
    await item.getByRole('button', { name: 'Disconnect Claude' }).click()
    await expect(page.getByText('No assistant is connected yet.')).toBeVisible()
    expect((await callMcp(token)).status).toBe(401)
  })

  test('opens the page before the worker lists the assistants', async ({ page }) => {
    await createPasskey(page)
    await page.goto('/settings/')
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    await page.route('**/api/connections', async (route) => {
      await held
      await route.continue()
    })

    // The navigation settles while the worker has not answered yet.
    const navigated = page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const { navigation } = window as unknown as { navigation: EventTarget }
          navigation.addEventListener('navigatesuccess', () => resolve(), { once: true })
        })
    )
    await page.getByRole('link', { name: 'AI assistants' }).click()
    await navigated
    await expect(page.locator('#assistants-status')).toHaveText('Loading…')

    answer()
    await expect(page.getByText('No assistant is connected yet.')).toBeVisible()
  })

  test("sends the assistant back with access_denied when the user doesn't allow it", async ({ page }) => {
    await createPasskey(page)
    const assistant = await prepareAssistant()
    await page.goto(assistant.authorizeUrl)
    await page.getByRole('button', { name: "Don't allow" }).click()
    await page.waitForURL(/^https:\/\/assistant\.example\/callback/)
    expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied')
  })

  test('says when the link has expired', async ({ page }) => {
    await page.goto('/connect/?request=unknown')
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow with passkey' })).toBeHidden()
  })
})
