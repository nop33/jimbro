import { bearerToken, hashToken } from './auth'
import { isAllowedOrigin, type OriginEnv } from './origins'
import {
  ALGORITHMS,
  checkAuthenticatorData,
  fromBase64Url,
  importPublicKey,
  randomBase64Url,
  readClientData,
  toBase64Url,
  verifyAssertion
} from './webauthn'

export interface PasskeyEnv extends OriginEnv {
  jimbro: D1Database
}

// How long a challenge stays good, which is also the timeout the browser gets.
export const CHALLENGE_TTL_MS = 5 * 60_000

type Purpose = 'register' | 'signin' | 'add'

const fail = (error: string, status = 400) => Response.json({ error }, { status })

// The relying party: the app's origin, from the request's Origin header, and its hostname as the RP ID. The app and
// the worker live on different hosts, so the RP ID follows the app: jimbro.nop33.com in production, localhost locally.
const relyingParty = (request: Request, env: OriginEnv) => {
  const origin = request.headers.get('Origin')
  if (!isAllowedOrigin(origin, env)) return null
  return { origin, rpId: new URL(origin).hostname }
}

const newChallenge = async (db: D1Database, purpose: Purpose, userId: string | null) => {
  const challenge = randomBase64Url(32)
  const now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?1').bind(now),
    db
      .prepare('INSERT INTO auth_challenges (challenge, purpose, user_id, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(challenge, purpose, userId, now + CHALLENGE_TTL_MS)
  ])
  return challenge
}

// Deletes the challenge, so it is good for one verify, and resolves to it when it was issued for this purpose and
// has not expired.
const takeChallenge = async (db: D1Database, challenge: string, purpose: Purpose) => {
  const row = await db
    .prepare('DELETE FROM auth_challenges WHERE challenge = ?1 RETURNING purpose, user_id, expires_at')
    .bind(challenge)
    .first<{ purpose: string; user_id: string | null; expires_at: number }>()
  if (!row || row.purpose !== purpose || row.expires_at < Date.now()) return null
  return { userId: row.user_id }
}

const newToken = async (db: D1Database, userId: string, now: string) => {
  const token = randomBase64Url(32)
  const statement = db
    .prepare('INSERT INTO auth_tokens (token_hash, user_id, created_at) VALUES (?1, ?2, ?3)')
    .bind(await hashToken(token), userId, now)
  return { token, statement }
}

const readBody = async (request: Request, fields: string[]) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const decoded: Record<string, Uint8Array<ArrayBuffer>> = {}
  for (const field of fields) {
    const value = record[field]
    if (typeof value !== 'string') return null
    const bytes = fromBase64Url(value)
    if (!bytes) return null
    decoded[field] = bytes
  }
  return { record, decoded }
}

// What the browser's navigator.credentials.create() takes, with every buffer as base64url.
const creationOptions = (challenge: string, rpId: string, userId: string, exclude: string[]) => ({
  challenge,
  rp: { id: rpId, name: 'Jimbro' },
  user: { id: toBase64Url(new TextEncoder().encode(userId)), name: 'Jimbro', displayName: 'Jimbro' },
  pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
  authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
  attestation: 'none',
  timeout: CHALLENGE_TTL_MS,
  excludeCredentials: exclude.map((id) => ({ type: 'public-key', id }))
})

const reject = (error: string) => ({ ok: false as const, error })

// Checks a registration the browser made for a challenge of this purpose, and resolves to the passkey to store and the
// user the challenge was issued for.
const verifyRegistration = async (request: Request, env: PasskeyEnv, purpose: 'register' | 'add') => {
  const rp = relyingParty(request, env)
  if (!rp) return reject('origin_not_allowed')
  const body = await readBody(request, ['id', 'clientDataJSON', 'authenticatorData', 'publicKey'])
  if (!body) return reject('invalid_body')
  const alg = body.record.publicKeyAlgorithm
  const clientData = readClientData(body.decoded.clientDataJSON)
  if (!clientData) return reject('invalid_client_data')
  const challenge = await takeChallenge(env.jimbro, clientData.challenge, purpose)
  if (!challenge?.userId) return reject('invalid_challenge')
  if (clientData.type !== 'webauthn.create') return reject('wrong_type')
  if (clientData.origin !== rp.origin) return reject('wrong_origin')
  const checked = await checkAuthenticatorData(body.decoded.authenticatorData, rp.rpId, body.decoded.id)
  if (!checked.ok) return reject(checked.error)
  if (typeof alg !== 'number' || !(await importPublicKey(body.decoded.publicKey, alg))) {
    return reject('unsupported_public_key')
  }
  return {
    ok: true as const,
    userId: challenge.userId,
    passkey: {
      id: toBase64Url(body.decoded.id),
      publicKey: toBase64Url(body.decoded.publicKey),
      alg,
      signCount: checked.data.signCount
    }
  }
}

type Passkey = Extract<Awaited<ReturnType<typeof verifyRegistration>>, { ok: true }>['passkey']

const insertPasskey = (db: D1Database, userId: string, passkey: Passkey, now: string) =>
  db
    .prepare(
      'INSERT INTO passkeys (id, user_id, public_key, alg, sign_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    )
    .bind(passkey.id, userId, passkey.publicKey, passkey.alg, passkey.signCount, now)

const passkeyExists = async (db: D1Database, id: string) =>
  (await db.prepare('SELECT 1 AS found FROM passkeys WHERE id = ?1').bind(id).first()) !== null

// POST /auth/register/options: a challenge for a new account's first passkey.
export const registerOptions = async (request: Request, env: PasskeyEnv) => {
  const rp = relyingParty(request, env)
  if (!rp) return fail('origin_not_allowed', 403)
  const userId = crypto.randomUUID()
  const challenge = await newChallenge(env.jimbro, 'register', userId)
  return Response.json(creationOptions(challenge, rp.rpId, userId, []))
}

// POST /auth/register/verify: stores the account and its passkey, and signs it in.
export const registerVerify = async (request: Request, env: PasskeyEnv) => {
  const verified = await verifyRegistration(request, env, 'register')
  if (!verified.ok) return fail(verified.error)
  if (await passkeyExists(env.jimbro, verified.passkey.id)) return fail('credential_exists', 409)
  const now = new Date().toISOString()
  const { token, statement } = await newToken(env.jimbro, verified.userId, now)
  await env.jimbro.batch([
    env.jimbro.prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2)').bind(verified.userId, now),
    insertPasskey(env.jimbro, verified.userId, verified.passkey, now),
    statement
  ])
  return Response.json({ userId: verified.userId, token })
}

// POST /auth/signin/options: a challenge for any of the site's passkeys, which the browser lets the user pick.
export const signInOptions = async (request: Request, env: PasskeyEnv) => {
  const rp = relyingParty(request, env)
  if (!rp) return fail('origin_not_allowed', 403)
  const challenge = await newChallenge(env.jimbro, 'signin', null)
  return Response.json({
    challenge,
    rpId: rp.rpId,
    allowCredentials: [],
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS
  })
}

// POST /auth/signin/verify: checks the assertion against the stored passkey, and hands out a new token.
export const signInVerify = async (request: Request, env: PasskeyEnv) => {
  const rp = relyingParty(request, env)
  if (!rp) return fail('origin_not_allowed', 403)
  const body = await readBody(request, ['id', 'clientDataJSON', 'authenticatorData', 'signature'])
  if (!body) return fail('invalid_body')
  const { id, clientDataJSON, authenticatorData, signature } = body.decoded
  const clientData = readClientData(clientDataJSON)
  if (!clientData) return fail('invalid_client_data')
  if (!(await takeChallenge(env.jimbro, clientData.challenge, 'signin'))) return fail('invalid_challenge')
  if (clientData.type !== 'webauthn.get') return fail('wrong_type')
  if (clientData.origin !== rp.origin) return fail('wrong_origin')
  const checked = await checkAuthenticatorData(authenticatorData, rp.rpId)
  if (!checked.ok) return fail(checked.error)

  const stored = await env.jimbro
    .prepare('SELECT user_id, public_key, alg, sign_count FROM passkeys WHERE id = ?1')
    .bind(toBase64Url(id))
    .first<{ user_id: string; public_key: string; alg: number; sign_count: number }>()
  if (!stored) return fail('unknown_credential', 401)
  const spki = fromBase64Url(stored.public_key)
  const key = spki && (await importPublicKey(spki, stored.alg))
  if (!key || !(await verifyAssertion(key, stored.alg, signature, authenticatorData, clientDataJSON))) {
    return fail('bad_signature', 401)
  }
  // Synced passkeys report 0. A counter that has started must grow, or the passkey may have been cloned.
  const signCount = checked.data.signCount
  if ((signCount !== 0 || stored.sign_count !== 0) && signCount <= stored.sign_count) return fail('sign_count', 401)

  const { token, statement } = await newToken(env.jimbro, stored.user_id, new Date().toISOString())
  await env.jimbro.batch([
    env.jimbro.prepare('UPDATE passkeys SET sign_count = ?1 WHERE id = ?2').bind(signCount, toBase64Url(id)),
    statement
  ])
  return Response.json({ userId: stored.user_id, token })
}

// POST /api/passkeys/options: a challenge for one more passkey on the signed-in account.
export const addPasskeyOptions = async (request: Request, env: PasskeyEnv, userId: string) => {
  const rp = relyingParty(request, env)
  if (!rp) return fail('origin_not_allowed', 403)
  const existing = await env.jimbro
    .prepare('SELECT id FROM passkeys WHERE user_id = ?1')
    .bind(userId)
    .all<{ id: string }>()
  const challenge = await newChallenge(env.jimbro, 'add', userId)
  return Response.json(
    creationOptions(
      challenge,
      rp.rpId,
      userId,
      existing.results.map((row) => row.id)
    )
  )
}

// POST /api/passkeys/verify: stores the passkey on the account that asked for the challenge.
export const addPasskeyVerify = async (request: Request, env: PasskeyEnv, userId: string) => {
  const verified = await verifyRegistration(request, env, 'add')
  if (!verified.ok) return fail(verified.error)
  if (verified.userId !== userId) return fail('invalid_challenge')
  if (await passkeyExists(env.jimbro, verified.passkey.id)) return fail('credential_exists', 409)
  await insertPasskey(env.jimbro, userId, verified.passkey, new Date().toISOString()).run()
  return Response.json({ ok: true })
}

// POST /api/signout: forgets the token, when a passkey handed it out. AUTH_TOKENS tokens stay.
export const signOut = async (request: Request, env: PasskeyEnv) => {
  const token = bearerToken(request.headers.get('Authorization'))
  if (token) {
    await env.jimbro
      .prepare('DELETE FROM auth_tokens WHERE token_hash = ?1')
      .bind(await hashToken(token))
      .run()
  }
  return Response.json({ ok: true })
}
