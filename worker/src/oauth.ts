import { bearerToken, hashToken } from './auth'
import { isAllowedOrigin, type OriginEnv } from './origins'
import { assertionOptions, verifyAssertionFor, type PasskeyEnv } from './passkeys'
import { toBase64Url } from '../../src/sync/base64url'
import { randomBase64Url, sha256 } from './webauthn'

// The worker as an OAuth 2.1 authorization server for /mcp, as the MCP authorization spec asks, so an AI assistant
// connects with a link and a passkey: it reads the metadata, registers (or names itself with a Client ID Metadata
// Document), and sends the user to /oauth/authorize. That hands the request to the app's /connect/ page, where the user
// approves with a passkey, and the assistant swaps the code it gets back for tokens. The tokens are read-only: they work
// on /mcp only, and a device's sign-in, claim or sign-out leaves them alone. Settings lists and disconnects them.

export interface OAuthEnv extends PasskeyEnv, OriginEnv {
  // The app, where /connect/ asks the user. Production when unset.
  APP_ORIGIN?: string
}

// The one scope: reading workouts, exercises and programs.
export const SCOPE = 'workouts:read'

const REQUEST_TTL_MS = 10 * 60_000
const CODE_TTL_MS = 60_000
const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 60 * 24 * 60 * 60_000

// OAuth tokens carry a prefix, so /mcp knows to look them up in oauth_grants, and nothing else takes them.
const ACCESS_PREFIX = 'jba_'
const REFRESH_PREFIX = 'jbr_'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const issuerOf = (request: Request) => new URL(request.url).origin

// The MCP server's canonical URI, which every token is bound to.
export const resourceOf = (request: Request) => `${issuerOf(request)}/mcp`

const appOrigin = (env: OAuthEnv) => env.APP_ORIGIN ?? 'https://jimbro.nop33.com'

export const resourceMetadataUrl = (request: Request) => `${issuerOf(request)}/.well-known/oauth-protected-resource/mcp`

// The paths any origin may call, since an assistant may run in a browser: the MCP server, its metadata and the token
// endpoints. The app's own routes keep to the app's origins.
export const isOpenPath = (path: string) =>
  path === '/mcp' ||
  path.startsWith('/.well-known/') ||
  ['/oauth/register', '/oauth/token', '/oauth/revoke'].includes(path)

const noStore = { 'Cache-Control': 'no-store' }

const oauthError = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: noStore })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// GET /.well-known/oauth-protected-resource[/mcp] (RFC 9728)
export const protectedResourceMetadata = (request: Request) =>
  Response.json({
    resource: resourceOf(request),
    authorization_servers: [issuerOf(request)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Jimbro'
  })

// GET /.well-known/oauth-authorization-server (RFC 8414)
export const authorizationServerMetadata = (request: Request) => {
  const issuer = issuerOf(request)
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true
  })
}

// The 401 /mcp answers without a token it takes, which points the assistant at the metadata.
export const mcpUnauthorized = (request: Request, hadToken: boolean) =>
  Response.json(
    { error: 'unauthorized' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl(request)}", scope="${SCOPE}"${hadToken ? ', error="invalid_token"' : ''}`
      }
    }
  )

// A redirect URI an assistant may use: https, or http on this computer for a desktop app. No fragment.
const validRedirectUri = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2000) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
}

const isLoopback = (uri: string) => {
  const url = new URL(uri)
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

// The registered URI exactly, except that a desktop app's loopback URI may use any port (OAuth 2.1, section 8.4.2).
const redirectMatches = (registered: string, asked: string) => {
  if (registered === asked) return true
  if (!validRedirectUri(asked) || !isLoopback(registered) || !isLoopback(asked)) return false
  const left = new URL(registered)
  const right = new URL(asked)
  return left.hostname === right.hostname && left.pathname === right.pathname && left.search === right.search
}

interface Client {
  id: string
  name: string
  redirectUris: string[]
}

const clientName = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 100) : 'An AI assistant'

const readRedirectUris = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) return null
  return value.every(validRedirectUri) ? (value as string[]) : null
}

// A client that names itself with an https URL serves its metadata there (Client ID Metadata Document). The document
// has to name the same URL, and lists the redirect URIs the client may use.
const fetchClientDocument = async (clientId: string): Promise<Client | null> => {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.pathname === '/' || url.hash || url.username || url.password) return null
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) return null
    const text = await response.text()
    if (text.length > 20_000) return null
    const document: unknown = JSON.parse(text)
    if (!isRecord(document) || document.client_id !== clientId) return null
    const redirectUris = readRedirectUris(document.redirect_uris)
    if (!redirectUris) return null
    return { id: clientId, name: clientName(document.client_name), redirectUris }
  } catch {
    return null
  }
}

const findClient = async (db: D1Database, clientId: string): Promise<Client | null> => {
  if (clientId === '' || clientId.length > 2000) return null
  if (clientId.startsWith('https://')) return fetchClientDocument(clientId)
  const row = await db
    .prepare('SELECT name, redirect_uris FROM oauth_clients WHERE id = ?1')
    .bind(clientId)
    .first<{ name: string; redirect_uris: string }>()
  if (!row) return null
  return { id: clientId, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as string[] }
}

// POST /oauth/register (RFC 7591): a public client, which proves itself with PKCE instead of a secret.
export const registerClient = async (request: Request, env: OAuthEnv) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return oauthError('invalid_client_metadata', 'The body is not JSON')
  }
  if (!isRecord(body)) return oauthError('invalid_client_metadata', 'The body is not an object')
  const redirectUris = readRedirectUris(body.redirect_uris)
  if (!redirectUris) {
    return oauthError('invalid_redirect_uri', 'Give 1 to 10 redirect URIs, each https or http on localhost')
  }
  const id = randomBase64Url(16)
  const name = clientName(body.client_name)
  const now = new Date()
  await env.jimbro
    .prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(id, name, JSON.stringify(redirectUris), now.toISOString())
    .run()
  return Response.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    },
    { status: 201, headers: noStore }
  )
}

// The redirect back to the assistant, with the issuer (RFC 9207) and the state it sent.
const backTo = (redirectUri: string, params: Record<string, string>, state: string | null, issuer: string) => {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (state !== null) url.searchParams.set('state', state)
  url.searchParams.set('iss', issuer)
  return url.toString()
}

// The resource an assistant names, compared without case in the scheme and host, or the server's own when it names
// none. Null when it names another.
const resourceFor = (request: Request, asked: string | null) => {
  const own = resourceOf(request)
  if (asked === null || asked === '') return own
  try {
    const url = new URL(asked)
    const normalised = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
    return normalised === own && !url.search && !url.hash ? own : null
  } catch {
    return null
  }
}

const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/

// A page the browser shows when the request can't go back to the assistant: the client or the redirect URI is wrong.
const cannotConnect = (message: string) =>
  new Response(`Jimbro can't connect this assistant: ${message}`, {
    status: 400,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...noStore }
  })

// GET /oauth/authorize: checks the request, keeps it, and sends the browser to the app's /connect/ page.
export const authorize = async (request: Request, env: OAuthEnv) => {
  const params = new URL(request.url).searchParams
  const client = await findClient(env.jimbro, params.get('client_id') ?? '')
  if (!client) return cannotConnect('it is not registered.')
  const asked = params.get('redirect_uri')
  const redirectUri =
    asked === null
      ? client.redirectUris.length === 1
        ? client.redirectUris[0]
        : null
      : client.redirectUris.some((registered) => redirectMatches(registered, asked))
        ? asked
        : null
  if (!redirectUri) return cannotConnect('its redirect URI is not registered.')

  const state = params.get('state')
  const issuer = issuerOf(request)
  const refuse = (error: string, description: string) =>
    Response.redirect(backTo(redirectUri, { error, error_description: description }, state, issuer), 302)
  if (params.get('response_type') !== 'code') return refuse('unsupported_response_type', 'Only code is supported')
  const challenge = params.get('code_challenge') ?? ''
  if (!PKCE_CHALLENGE.test(challenge) || params.get('code_challenge_method') !== 'S256') {
    return refuse('invalid_request', 'PKCE with S256 is required')
  }
  if (state !== null && state.length > 1000) return refuse('invalid_request', 'The state is too long')
  const resource = resourceFor(request, params.get('resource'))
  if (!resource) return refuse('invalid_target', `Tokens are only for ${resourceOf(request)}`)

  const id = randomBase64Url(24)
  const now = Date.now()
  await env.jimbro.batch([
    env.jimbro.prepare('DELETE FROM oauth_requests WHERE expires_at < ?1').bind(now),
    env.jimbro
      .prepare(
        `INSERT INTO oauth_requests (id, client_id, client_name, redirect_uri, state, code_challenge, scope, resource,
          expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
      .bind(id, client.id, client.name, redirectUri, state, challenge, SCOPE, resource, now + REQUEST_TTL_MS)
  ])
  return Response.redirect(`${appOrigin(env)}/connect/?request=${id}`, 302)
}

interface PendingRequest {
  client_name: string
  redirect_uri: string
  state: string | null
}

const pendingRequest = (db: D1Database, id: unknown) =>
  typeof id === 'string' && id !== ''
    ? db
        .prepare(
          'SELECT client_name, redirect_uri, state FROM oauth_requests WHERE id = ?1 AND user_id IS NULL AND expires_at > ?2'
        )
        .bind(id, Date.now())
        .first<PendingRequest>()
    : Promise.resolve(null)

const fail = (error: string, status = 400) => Response.json({ error }, { status })

const readJson = async (request: Request) => {
  try {
    const body: unknown = await request.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

// Only the app's /connect/ page calls the connect routes.
const appOnly = (request: Request, env: OAuthEnv) => isAllowedOrigin(request.headers.get('Origin'), env)

// POST /auth/connect/request: what /connect/ shows about a waiting request.
export const connectRequest = async (request: Request, env: OAuthEnv) => {
  if (!appOnly(request, env)) return fail('origin_not_allowed', 403)
  const body = await readJson(request)
  const pending = await pendingRequest(env.jimbro, body?.request)
  if (!pending) return fail('unknown_request', 404)
  const redirect = new URL(pending.redirect_uri)
  return Response.json({
    clientName: pending.client_name,
    redirectHost: redirect.host,
    onThisComputer: isLoopback(pending.redirect_uri)
  })
}

// POST /auth/connect/options: a passkey challenge for approving a request.
export const connectOptions = (request: Request, env: OAuthEnv) => assertionOptions(request, env, 'connect')

// POST /auth/connect/verify: the user approved with a passkey. Gives the request a code for the passkey's account,
// and answers where the browser goes next. No device token is made, so the device backing up is left as it is.
export const connectVerify = async (request: Request, env: OAuthEnv) => {
  const verified = await verifyAssertionFor(request, env, 'connect')
  if (!verified.ok) return verified.response
  const pending = await pendingRequest(env.jimbro, verified.body.request)
  if (!pending) return fail('unknown_request', 404)
  const code = randomBase64Url(32)
  const [, approved] = await env.jimbro.batch([
    verified.storeSignCount,
    env.jimbro
      .prepare(
        'UPDATE oauth_requests SET user_id = ?1, code_hash = ?2, expires_at = ?3 WHERE id = ?4 AND user_id IS NULL AND expires_at > ?5'
      )
      .bind(verified.userId, await hashToken(code), Date.now() + CODE_TTL_MS, verified.body.request, Date.now())
  ])
  if (approved.meta.changes !== 1) return fail('unknown_request', 404)
  return Response.json({ redirect: backTo(pending.redirect_uri, { code }, pending.state, issuerOf(request)) })
}

// POST /auth/connect/deny: the user said no.
export const connectDeny = async (request: Request, env: OAuthEnv) => {
  if (!appOnly(request, env)) return fail('origin_not_allowed', 403)
  const body = await readJson(request)
  const id = body?.request
  if (typeof id !== 'string') return fail('unknown_request', 404)
  const pending = await env.jimbro
    .prepare('DELETE FROM oauth_requests WHERE id = ?1 AND user_id IS NULL RETURNING redirect_uri, state')
    .bind(id)
    .first<{ redirect_uri: string; state: string | null }>()
  if (!pending) return fail('unknown_request', 404)
  const redirect = backTo(
    pending.redirect_uri,
    { error: 'access_denied', error_description: 'The user said no' },
    pending.state,
    issuerOf(request)
  )
  return Response.json({ redirect })
}

const pkceChallengeOf = async (verifier: string) => toBase64Url(await sha256(new TextEncoder().encode(verifier)))

const newTokens = async () => {
  const access = `${ACCESS_PREFIX}${randomBase64Url(32)}`
  const refresh = `${REFRESH_PREFIX}${randomBase64Url(32)}`
  return { access, refresh, accessHash: await hashToken(access), refreshHash: await hashToken(refresh) }
}

const tokenResponse = (tokens: { access: string; refresh: string }, scope: string) =>
  Response.json(
    {
      access_token: tokens.access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: tokens.refresh,
      scope
    },
    { headers: noStore }
  )

const exchangeCode = async (request: Request, env: OAuthEnv, form: URLSearchParams) => {
  const code = form.get('code') ?? ''
  const verifier = form.get('code_verifier') ?? ''
  if (code === '' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    return oauthError('invalid_request', 'Send the code and its code_verifier')
  }
  const codeHash = await hashToken(code)
  const grantId = randomBase64Url(16)
  const now = Date.now()
  // Taking the code marks it used, so it is good for one exchange.
  const row = await env.jimbro
    .prepare(
      `UPDATE oauth_requests SET grant_id = ?1 WHERE code_hash = ?2 AND grant_id IS NULL AND expires_at > ?3
        RETURNING client_id, client_name, redirect_uri, code_challenge, scope, resource, user_id`
    )
    .bind(grantId, codeHash, now)
    .first<{
      client_id: string
      client_name: string
      redirect_uri: string
      code_challenge: string
      scope: string
      resource: string
      user_id: string
    }>()
  if (!row) {
    // A code used twice may have leaked, so the tokens the first exchange got stop working (OAuth 2.1, 4.1.3).
    await env.jimbro
      .prepare(
        'DELETE FROM oauth_grants WHERE id = (SELECT grant_id FROM oauth_requests WHERE code_hash = ?1 AND grant_id IS NOT NULL)'
      )
      .bind(codeHash)
      .run()
    return oauthError('invalid_grant', 'The code is unknown, used or expired')
  }
  if (form.get('client_id') !== row.client_id) return oauthError('invalid_grant', 'The code is for another client')
  const redirectUri = form.get('redirect_uri')
  if (redirectUri !== null && redirectUri !== row.redirect_uri) {
    return oauthError('invalid_grant', 'The redirect_uri differs from the authorization request')
  }
  if ((await pkceChallengeOf(verifier)) !== row.code_challenge) {
    return oauthError('invalid_grant', 'The code_verifier does not match')
  }
  if (resourceFor(request, form.get('resource')) !== row.resource) {
    return oauthError('invalid_target', `Tokens are only for ${row.resource}`)
  }

  const tokens = await newTokens()
  const createdAt = new Date(now).toISOString()
  await env.jimbro.batch([
    env.jimbro.prepare('DELETE FROM oauth_grants WHERE refresh_expires_at < ?1').bind(now),
    // Connecting the same assistant again replaces its connection, so Settings lists it once.
    env.jimbro
      .prepare('DELETE FROM oauth_grants WHERE user_id = ?1 AND client_id = ?2')
      .bind(row.user_id, row.client_id),
    env.jimbro
      .prepare(
        `INSERT INTO oauth_grants (id, user_id, client_id, client_name, scope, resource, access_hash, access_expires_at,
          refresh_hash, refresh_expires_at, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`
      )
      .bind(
        grantId,
        row.user_id,
        row.client_id,
        row.client_name,
        row.scope,
        row.resource,
        tokens.accessHash,
        now + ACCESS_TTL_MS,
        tokens.refreshHash,
        now + REFRESH_TTL_MS,
        createdAt
      )
  ])
  return tokenResponse(tokens, row.scope)
}

// Swaps a refresh token for new tokens. Both change, so the old refresh token stops working (OAuth 2.1, 4.3.1).
const refresh = async (request: Request, env: OAuthEnv, form: URLSearchParams) => {
  const token = form.get('refresh_token') ?? ''
  if (!token.startsWith(REFRESH_PREFIX)) return oauthError('invalid_grant', 'The refresh token is unknown or expired')
  const oldHash = await hashToken(token)
  const now = Date.now()
  const grant = await env.jimbro
    .prepare('SELECT client_id, scope, resource FROM oauth_grants WHERE refresh_hash = ?1 AND refresh_expires_at > ?2')
    .bind(oldHash, now)
    .first<{ client_id: string; scope: string; resource: string }>()
  if (!grant) return oauthError('invalid_grant', 'The refresh token is unknown or expired')
  const clientId = form.get('client_id')
  if (clientId !== null && clientId !== grant.client_id) {
    return oauthError('invalid_grant', 'The refresh token is for another client')
  }
  if (resourceFor(request, form.get('resource')) !== grant.resource) {
    return oauthError('invalid_target', `Tokens are only for ${grant.resource}`)
  }
  const tokens = await newTokens()
  const rotated = await env.jimbro
    .prepare(
      `UPDATE oauth_grants SET access_hash = ?1, access_expires_at = ?2, refresh_hash = ?3, refresh_expires_at = ?4
        WHERE refresh_hash = ?5`
    )
    .bind(tokens.accessHash, now + ACCESS_TTL_MS, tokens.refreshHash, now + REFRESH_TTL_MS, oldHash)
    .run()
  // Two refreshes with one token: only the first rotates.
  if (rotated.meta.changes !== 1) return oauthError('invalid_grant', 'The refresh token is unknown or expired')
  return tokenResponse(tokens, grant.scope)
}

const readForm = async (request: Request) => {
  const type = request.headers.get('Content-Type') ?? ''
  if (!type.startsWith('application/x-www-form-urlencoded')) return null
  return new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()))
}

// POST /oauth/token
export const token = async (request: Request, env: OAuthEnv) => {
  const form = await readForm(request)
  if (!form) return oauthError('invalid_request', 'Send the form as application/x-www-form-urlencoded')
  const grantType = form.get('grant_type')
  if (grantType === 'authorization_code') return exchangeCode(request, env, form)
  if (grantType === 'refresh_token') return refresh(request, env, form)
  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
}

// POST /oauth/revoke (RFC 7009): either token ends the connection. An unknown token is no error.
export const revoke = async (request: Request, env: OAuthEnv) => {
  const form = await readForm(request)
  if (!form) return oauthError('invalid_request', 'Send the form as application/x-www-form-urlencoded')
  const value = form.get('token') ?? ''
  if (value !== '') {
    await env.jimbro
      .prepare('DELETE FROM oauth_grants WHERE access_hash = ?1 OR refresh_hash = ?1')
      .bind(await hashToken(value))
      .run()
  }
  return new Response(null, { status: 200, headers: noStore })
}

// The user an OAuth access token reads for, when it is live and was issued for this server. Marks the connection used.
export const resolveAccessToken = async (request: Request, env: OAuthEnv) => {
  const value = bearerToken(request.headers.get('Authorization'))
  if (!value?.startsWith(ACCESS_PREFIX)) return null
  const now = Date.now()
  const row = await env.jimbro
    .prepare(
      `UPDATE oauth_grants SET last_used_at = ?1 WHERE access_hash = ?2 AND access_expires_at > ?3 AND resource = ?4
        RETURNING user_id`
    )
    .bind(new Date(now).toISOString(), await hashToken(value), now, resourceOf(request))
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}

// GET /api/connections: the assistants connected to the account, for Settings.
export const listConnections = async (env: OAuthEnv, userId: string) => {
  const { results } = await env.jimbro
    .prepare(
      'SELECT id, client_name, created_at, last_used_at FROM oauth_grants WHERE user_id = ?1 AND refresh_expires_at > ?2 ORDER BY created_at DESC'
    )
    .bind(userId, Date.now())
    .all<{ id: string; client_name: string; created_at: string; last_used_at: string }>()
  return Response.json({
    connections: results.map((row) => ({
      id: row.id,
      name: row.client_name,
      connectedAt: row.created_at,
      lastUsedAt: row.last_used_at
    }))
  })
}

// POST /api/connections/revoke: Disconnect in Settings. The assistant's next call answers 401.
export const revokeConnection = async (request: Request, env: OAuthEnv, userId: string) => {
  const body = await readJson(request)
  if (typeof body?.id !== 'string') return fail('invalid_body')
  await env.jimbro.prepare('DELETE FROM oauth_grants WHERE id = ?1 AND user_id = ?2').bind(body.id, userId).run()
  return Response.json({ ok: true })
}
