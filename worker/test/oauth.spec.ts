import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { Row } from '../../src/db/types'
import { toBase64Url } from '../../src/sync/base64url'
import { APP_ORIGIN, errorOf, newAuthenticator, newClient, sha256, signUp, utf8 } from './passkeyHelpers'

// An AI assistant connecting to /mcp the way the MCP authorization spec says: discovery, registration, the passkey
// approval on the app's /connect/ page, the code exchange, then MCP calls with the token.

const WORKER = 'https://example.com'
const RESOURCE = `${WORKER}/mcp`
const REDIRECT = 'https://assistant.example/callback'

type Client = ReturnType<typeof newClient>
type Passkey = Awaited<ReturnType<typeof newAuthenticator>>

// Each assistant calls from an address of its own, so the per-address budget never trips across tests.
const assistantAddress = () => `assistant-${crypto.randomUUID()}`

const get = (path: string, address = assistantAddress(), headers: Record<string, string> = {}) =>
  SELF.fetch(`${WORKER}${path}`, { redirect: 'manual', headers: { 'CF-Connecting-IP': address, ...headers } })

const postForm = (path: string, form: Record<string, string>, address = assistantAddress()) =>
  SELF.fetch(`${WORKER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': address },
    body: new URLSearchParams(form).toString()
  })

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`${WORKER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': assistantAddress(), ...headers },
    body: JSON.stringify(body)
  })

const register = async (redirectUris = [REDIRECT], name = 'Claude') => {
  const response = await postJson('/oauth/register', { client_name: name, redirect_uris: redirectUris })
  expect(response.status).toBe(201)
  return ((await response.json()) as { client_id: string }).client_id
}

const pkce = async () => {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  return { verifier, challenge: toBase64Url(await sha256(utf8(verifier))) }
}

const authorizeUrl = (params: Record<string, string>) => `/oauth/authorize?${new URLSearchParams(params).toString()}`

// Starts an authorization and resolves to the request ID the app's /connect/ page gets.
const startAuthorization = async (clientId: string, challenge: string, extra: Record<string, string> = {}) => {
  const response = await get(
    authorizeUrl({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state-123',
      scope: 'workouts:read',
      resource: RESOURCE,
      ...extra
    })
  )
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('Location') ?? '')
  expect(`${location.origin}${location.pathname}`).toBe(`${APP_ORIGIN}/connect/`)
  return location.searchParams.get('request') ?? ''
}

// What the /connect/ page does when the user taps Allow with passkey: resolves to the URL it goes to.
const approve = async (client: Client, passkey: Passkey, request: string) => {
  const options = (await (await client.call('/auth/connect/options')).json()) as { challenge: string }
  const response = await client.call('/auth/connect/verify', { request, ...(await passkey.assert(options.challenge)) })
  expect(response.status).toBe(200)
  return new URL(((await response.json()) as { redirect: string }).redirect)
}

interface Tokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

const exchange = (clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) =>
  postForm('/oauth/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: REDIRECT,
    resource: RESOURCE,
    ...extra
  })

// Signs up a passkey account and connects an assistant to it, as a user would from claude.ai.
const connect = async () => {
  const { passkey, session, client } = await signUp()
  const clientId = await register()
  const { verifier, challenge } = await pkce()
  const request = await startAuthorization(clientId, challenge)
  const back = await approve(client, passkey, request)
  const response = await exchange(clientId, back.searchParams.get('code') ?? '', verifier)
  expect(response.status).toBe(200)
  return { passkey, session, client, clientId, tokens: (await response.json()) as Tokens }
}

const mcp = (token: string, method = 'tools/list', params: unknown = {}) =>
  SELF.fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })

const exercise = (id: string): Row => ({
  table: 'exercises',
  row: {
    id,
    name: 'Squat',
    kind: 'lifting',
    preset: 'lifting',
    muscle: 'quads',
    targetSets: 3,
    defaults: { reps: 5 },
    isDeleted: false,
    updatedAt: '2026-10-01T12:00:00.000Z'
  }
})

const push = (token: string, rows: Row[]) =>
  SELF.fetch(`${WORKER}/api/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  })

const catalogOf = async (response: Response) => {
  const body = (await response.json()) as { result: { structuredContent: { exercises: Array<{ id: string }> } } }
  return body.result.structuredContent.exercises.map((row) => row.id)
}

describe('discovery', () => {
  it('answers /mcp without a token with a 401 that points at the metadata', async () => {
    const response = await SELF.fetch(`${WORKER}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${WORKER}/.well-known/oauth-protected-resource/mcp", scope="workouts:read"`
    )
    const bad = await mcp('jba_nope')
    expect(bad.status).toBe(401)
    expect(bad.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
  })

  it('serves the protected resource metadata at the path and the root', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [WORKER],
        scopes_supported: ['workouts:read'],
        bearer_methods_supported: ['header'],
        resource_name: 'Jimbro'
      })
    }
  })

  it('serves the authorization server metadata, with PKCE S256 and both ways to register', async () => {
    const metadata = (await (await get('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>
    expect(metadata).toMatchObject({
      issuer: WORKER,
      authorization_endpoint: `${WORKER}/oauth/authorize`,
      token_endpoint: `${WORKER}/oauth/token`,
      registration_endpoint: `${WORKER}/oauth/register`,
      revocation_endpoint: `${WORKER}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true
    })
  })

  it('lets any origin call /mcp and the metadata, and keeps the app routes to the app', async () => {
    const preflight = await SELF.fetch(`${WORKER}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST' }
    })
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    const unauthorized = await SELF.fetch(`${WORKER}/mcp`, { method: 'POST', headers: { Origin: 'https://claude.ai' } })
    expect(unauthorized.headers.get('Access-Control-Expose-Headers')).toBe('WWW-Authenticate')
    const app = await SELF.fetch(`${WORKER}/api/ping`, { headers: { Origin: 'https://claude.ai' } })
    expect(app.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('client registration', () => {
  it('registers a public client', async () => {
    const response = await postJson('/oauth/register', {
      client_name: 'Claude',
      redirect_uris: [REDIRECT, 'http://localhost:33418/callback'],
      token_endpoint_auth_method: 'client_secret_post'
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [REDIRECT, 'http://localhost:33418/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token']
    })
  })

  it('refuses redirect URIs that are neither https nor on this computer', async () => {
    for (const uris of [[], ['http://evil.example/callback'], ['javascript:alert(1)'], ['https://a.example/#frag']]) {
      const response = await postJson('/oauth/register', { client_name: 'Bad', redirect_uris: uris })
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe('invalid_redirect_uri')
    }
  })
})

describe('authorization', () => {
  it('connects an assistant with a passkey, and the token reads the account through every tool', async () => {
    const { session, tokens } = await connect()
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'workouts:read' })
    expect(tokens.access_token).toMatch(/^jba_/)
    expect(tokens.refresh_token).toMatch(/^jbr_/)

    expect((await push(session.token, [exercise('oauth-squat')])).status).toBe(200)
    const listed = await mcp(tokens.access_token)
    expect(listed.status).toBe(200)
    expect(await catalogOf(await mcp(tokens.access_token, 'tools/call', { name: 'catalog', arguments: {} }))).toEqual([
      'oauth-squat'
    ])
  })

  it('sends the code back with the state and the issuer', async () => {
    const { passkey, client } = await signUp()
    const clientId = await register()
    const { challenge } = await pkce()
    const back = await approve(client, passkey, await startAuthorization(clientId, challenge))
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('state-123')
    expect(back.searchParams.get('iss')).toBe(WORKER)
    expect(back.searchParams.get('code')).toBeTruthy()
  })

  it('shows the connect page who asks and where it goes back to', async () => {
    const { client } = await signUp()
    const clientId = await register(['http://127.0.0.1:4567/cb'], 'Claude Code')
    const { challenge } = await pkce()
    const response = await get(
      authorizeUrl({
        response_type: 'code',
        client_id: clientId,
        // Desktop apps pick a free port each time.
        redirect_uri: 'http://127.0.0.1:61234/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
    )
    const request = new URL(response.headers.get('Location') ?? '').searchParams.get('request')
    const shown = await client.call('/auth/connect/request', { request })
    expect(await shown.json()).toEqual({
      clientName: 'Claude Code',
      redirectHost: '127.0.0.1:61234',
      onThisComputer: true
    })
  })

  it('refuses to send the browser to an unregistered redirect URI or for an unknown client', async () => {
    const clientId = await register()
    const { challenge } = await pkce()
    const base = { response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' }
    const unknown = await get(authorizeUrl({ ...base, client_id: 'nope', redirect_uri: REDIRECT }))
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('Location')).toBeNull()
    const elsewhere = await get(
      authorizeUrl({ ...base, client_id: clientId, redirect_uri: 'https://evil.example/callback' })
    )
    expect(elsewhere.status).toBe(400)
    expect(elsewhere.headers.get('Location')).toBeNull()
  })

  it('sends errors back to the assistant: no PKCE, plain PKCE, another resource, another response type', async () => {
    const clientId = await register()
    const { challenge } = await pkce()
    const cases: Array<[Record<string, string>, string]> = [
      [{ code_challenge: '' }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      [{ response_type: 'token' }, 'unsupported_response_type']
    ]
    for (const [override, error] of cases) {
      const response = await get(
        authorizeUrl({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 's',
          ...override
        })
      )
      expect(response.status).toBe(302)
      const location = new URL(response.headers.get('Location') ?? '')
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT)
      expect(location.searchParams.get('error')).toBe(error)
      expect(location.searchParams.get('state')).toBe('s')
    }
  })

  it('sends access_denied back when the user says no', async () => {
    const { client } = await signUp()
    const clientId = await register()
    const { challenge } = await pkce()
    const request = await startAuthorization(clientId, challenge)
    const response = await client.call('/auth/connect/deny', { request })
    const back = new URL(((await response.json()) as { redirect: string }).redirect)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('state')).toBe('state-123')
    expect((await client.call('/auth/connect/request', { request })).status).toBe(404)
  })

  it('approves a request once', async () => {
    const { passkey, client } = await signUp()
    const clientId = await register()
    const { challenge } = await pkce()
    const request = await startAuthorization(clientId, challenge)
    await approve(client, passkey, request)
    const options = (await (await client.call('/auth/connect/options')).json()) as { challenge: string }
    const again = await client.call('/auth/connect/verify', { request, ...(await passkey.assert(options.challenge)) })
    expect(again.status).toBe(404)
  })

  it('takes the connect routes from the app only', async () => {
    const response = await SELF.fetch(`${WORKER}/auth/connect/options`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'CF-Connecting-IP': assistantAddress() }
    })
    expect(response.status).toBe(403)
  })

  it('connects a client that names itself with a metadata document', async () => {
    const documentUrl = 'https://assistant.example/oauth/client.json'
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((input instanceof Request ? input.url : input.toString()) === documentUrl) {
        return Response.json({ client_id: documentUrl, client_name: 'Doc Client', redirect_uris: [REDIRECT] })
      }
      return realFetch(input, init)
    }) as typeof fetch
    try {
      const { passkey, client } = await signUp()
      const { verifier, challenge } = await pkce()
      const request = await startAuthorization(documentUrl, challenge)
      expect(await (await client.call('/auth/connect/request', { request })).json()).toMatchObject({
        clientName: 'Doc Client'
      })
      const back = await approve(client, passkey, request)
      const response = await exchange(documentUrl, back.searchParams.get('code') ?? '', verifier)
      expect(response.status).toBe(200)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('tokens', () => {
  it('refuses a wrong code verifier, another client and another resource', async () => {
    for (const wrong of [
      { code_verifier: toBase64Url(crypto.getRandomValues(new Uint8Array(32))) },
      { client_id: 'someone-else' },
      { resource: 'https://other.example/mcp' }
    ] as Array<Record<string, string>>) {
      const { passkey, client } = await signUp()
      const clientId = await register()
      const { verifier, challenge } = await pkce()
      const back = await approve(client, passkey, await startAuthorization(clientId, challenge))
      const response = await exchange(clientId, back.searchParams.get('code') ?? '', verifier, wrong)
      expect(response.status).toBe(400)
      expect(['invalid_grant', 'invalid_target']).toContain(await errorOf(response))
    }
  })

  it('takes a code once, and a second exchange ends the connection the first one made', async () => {
    const { passkey, client } = await signUp()
    const clientId = await register()
    const { verifier, challenge } = await pkce()
    const back = await approve(client, passkey, await startAuthorization(clientId, challenge))
    const code = back.searchParams.get('code') ?? ''
    const first = (await (await exchange(clientId, code, verifier)).json()) as Tokens
    expect((await mcp(first.access_token)).status).toBe(200)
    const second = await exchange(clientId, code, verifier)
    expect(second.status).toBe(400)
    expect(await errorOf(second)).toBe('invalid_grant')
    expect((await mcp(first.access_token)).status).toBe(401)
  })

  it('refuses an expired code', async () => {
    const { passkey, client } = await signUp()
    const clientId = await register()
    const { verifier, challenge } = await pkce()
    const request = await startAuthorization(clientId, challenge)
    const back = await approve(client, passkey, request)
    await env.jimbro.prepare('UPDATE oauth_requests SET expires_at = 0 WHERE id = ?1').bind(request).run()
    const response = await exchange(clientId, back.searchParams.get('code') ?? '', verifier)
    expect(await errorOf(response)).toBe('invalid_grant')
  })

  it('rotates the refresh token, and the old tokens stop working', async () => {
    const { clientId, tokens } = await connect()
    const refreshed = await postForm('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId
    })
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as Tokens
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    expect((await mcp(next.access_token)).status).toBe(200)
    expect((await mcp(tokens.access_token)).status).toBe(401)
    const reused = await postForm('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId
    })
    expect(await errorOf(reused)).toBe('invalid_grant')
  })

  it('refuses an expired access token', async () => {
    const { tokens } = await connect()
    await env.jimbro.prepare('UPDATE oauth_grants SET access_expires_at = 0').run()
    expect((await mcp(tokens.access_token)).status).toBe(401)
  })

  it('revokes the connection with either token', async () => {
    const { tokens } = await connect()
    expect((await postForm('/oauth/revoke', { token: tokens.refresh_token })).status).toBe(200)
    expect((await mcp(tokens.access_token)).status).toBe(401)
  })

  it('works on /mcp only, never on the app routes', async () => {
    const { tokens } = await connect()
    const auth = { Authorization: `Bearer ${tokens.access_token}` }
    expect((await push(tokens.access_token, [exercise('nope')])).status).toBe(401)
    for (const path of ['/api/ping', '/api/pull', '/api/export', '/api/connections']) {
      expect((await SELF.fetch(`${WORKER}${path}`, { headers: auth })).status, path).toBe(401)
    }
    for (const path of ['/api/claim', '/api/signout', '/api/passkeys/options']) {
      expect((await SELF.fetch(`${WORKER}${path}`, { method: 'POST', headers: auth })).status, path).toBe(401)
    }
  })

  it('keeps working after the account moves to a new phone or the phone signs out', async () => {
    const { passkey, session, tokens } = await connect()
    const phone = newClient()
    const options = (await (await phone.call('/auth/signin/options')).json()) as { challenge: string }
    const signedIn = (await (
      await phone.call('/auth/signin/verify', await passkey.assert(options.challenge))
    ).json()) as { token: string }
    const claim = await SELF.fetch(`${WORKER}/api/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signedIn.token}` }
    })
    expect(claim.status).toBe(200)
    // The old phone's token is gone, the assistant's stays.
    expect((await push(session.token, [exercise('x')])).status).toBe(401)
    await SELF.fetch(`${WORKER}/api/signout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signedIn.token}` }
    })
    expect((await mcp(tokens.access_token)).status).toBe(200)
  })

  it('reads only the account that approved', async () => {
    const first = await connect()
    const second = await connect()
    await push(first.session.token, [exercise('first-only')])
    await push(second.session.token, [exercise('second-only')])
    const call = (token: string) => mcp(token, 'tools/call', { name: 'catalog', arguments: {} })
    expect(await catalogOf(await call(first.tokens.access_token))).toEqual(['first-only'])
    expect(await catalogOf(await call(second.tokens.access_token))).toEqual(['second-only'])
  })
})

describe('connections in Settings', () => {
  it('lists the connected assistants, and Disconnect ends one at once', async () => {
    const { session, tokens } = await connect()
    const auth = { Authorization: `Bearer ${session.token}` }
    const listed = (await (await SELF.fetch(`${WORKER}/api/connections`, { headers: auth })).json()) as {
      connections: Array<{ id: string; name: string; connectedAt: string; lastUsedAt: string }>
    }
    expect(listed.connections).toHaveLength(1)
    expect(listed.connections[0]).toMatchObject({ name: 'Claude' })

    const revoked = await SELF.fetch(`${WORKER}/api/connections/revoke`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: listed.connections[0].id })
    })
    expect(revoked.status).toBe(200)
    expect((await mcp(tokens.access_token)).status).toBe(401)
  })

  it('lists one connection when the same assistant connects again', async () => {
    const { passkey, session, client, clientId } = await connect()
    const { verifier, challenge } = await pkce()
    const back = await approve(client, passkey, await startAuthorization(clientId, challenge))
    expect((await exchange(clientId, back.searchParams.get('code') ?? '', verifier)).status).toBe(200)
    const listed = (await (
      await SELF.fetch(`${WORKER}/api/connections`, { headers: { Authorization: `Bearer ${session.token}` } })
    ).json()) as { connections: unknown[] }
    expect(listed.connections).toHaveLength(1)
  })

  it("never lists or disconnects another account's assistants", async () => {
    const mine = await connect()
    const other = await connect()
    const id = (
      (await (
        await SELF.fetch(`${WORKER}/api/connections`, { headers: { Authorization: `Bearer ${other.session.token}` } })
      ).json()) as { connections: Array<{ id: string }> }
    ).connections[0].id
    await SELF.fetch(`${WORKER}/api/connections/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mine.session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    expect((await mcp(other.tokens.access_token)).status).toBe(200)
  })
})
