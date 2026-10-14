import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { Row } from '../../src/db/types'
import { fromBase64Url, toBase64Url } from '../../src/sync/base64url'
import worker from '../src/index'

// A software authenticator: it makes the same bytes a phone's passkey would, with a key generated here, so these tests
// run the worker's checks on real signatures.

const APP_ORIGIN = 'https://jimbro.nop33.com'
const RP_ID = 'jimbro.nop33.com'

const UP = 0x01
const UV = 0x04
const AT = 0x40

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data))
const utf8 = (text: string) => new TextEncoder().encode(text)
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// WebCrypto signs ECDSA as r || s. Authenticators send DER, SEQUENCE { INTEGER r, INTEGER s }.
const rawToDer = (raw: Uint8Array) => {
  const integer = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value = bytes.slice(start)
    if (value[0] & 0x80) value = concat(new Uint8Array([0]), value)
    return concat(new Uint8Array([0x02, value.length]), value)
  }
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)))
  return concat(new Uint8Array([0x30, body.length]), body)
}

type Algorithm = 'ES256' | 'RS256'

const newAuthenticator = async (algorithm: Algorithm = 'ES256') => {
  const keys =
    algorithm === 'ES256'
      ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      : await crypto.subtle.generateKey(
          {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256'
          },
          true,
          ['sign', 'verify']
        )
  const { privateKey, publicKey } = keys as CryptoKeyPair
  const spki = new Uint8Array((await crypto.subtle.exportKey('spki', publicKey)) as ArrayBuffer)
  const credentialId = crypto.getRandomValues(new Uint8Array(16))
  let counter = 0

  const authenticatorData = async (options: {
    rpId?: string
    flags?: number
    signCount?: number
    attested?: boolean
  }) => {
    const count = new Uint8Array(4)
    new DataView(count.buffer).setUint32(0, options.signCount ?? counter)
    const head = concat(await sha256(utf8(options.rpId ?? RP_ID)), new Uint8Array([options.flags ?? UP | UV]), count)
    if (!options.attested) return head
    const idLength = new Uint8Array(2)
    new DataView(idLength.buffer).setUint16(0, credentialId.length)
    // The AAGUID, then the credential. A real authenticator puts the COSE key after it, which the worker never reads.
    return concat(head, new Uint8Array(16), idLength, credentialId, new Uint8Array([0xa0]))
  }

  const sign = async (data: Uint8Array) => {
    if (algorithm === 'RS256') {
      return new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, data))
    }
    return rawToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data)))
  }

  return {
    credentialId: toBase64Url(credentialId),
    // What the app sends after navigator.credentials.create().
    async register(
      challenge: string,
      options: { type?: string; origin?: string; rpId?: string; flags?: number; crossOrigin?: boolean } = {}
    ): Promise<Record<string, unknown>> {
      const clientData = utf8(
        JSON.stringify({
          type: options.type ?? 'webauthn.create',
          challenge,
          origin: options.origin ?? APP_ORIGIN,
          crossOrigin: options.crossOrigin ?? false
        })
      )
      return {
        id: toBase64Url(credentialId),
        clientDataJSON: toBase64Url(clientData),
        authenticatorData: toBase64Url(
          await authenticatorData({ rpId: options.rpId, flags: (options.flags ?? UP | UV) | AT, attested: true })
        ),
        publicKey: toBase64Url(spki),
        publicKeyAlgorithm: algorithm === 'ES256' ? -7 : -257
      }
    },
    // What the app sends after navigator.credentials.get().
    async assert(
      challenge: string,
      options: {
        type?: string
        origin?: string
        rpId?: string
        flags?: number
        signCount?: number
        tamper?: boolean
        crossOrigin?: boolean
      } = {}
    ): Promise<Record<string, unknown>> {
      counter = options.signCount ?? counter
      const clientData = utf8(
        JSON.stringify({
          type: options.type ?? 'webauthn.get',
          challenge,
          origin: options.origin ?? APP_ORIGIN,
          crossOrigin: options.crossOrigin ?? false
        })
      )
      const authData = await authenticatorData({ rpId: options.rpId, flags: options.flags })
      const signature = await sign(concat(authData, await sha256(clientData)))
      if (options.tamper) signature[signature.length - 1] ^= 0x01
      return {
        id: toBase64Url(credentialId),
        clientDataJSON: toBase64Url(clientData),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(signature)
      }
    }
  }
}

// Each test calls from an address of its own, so the per-address rate limit never trips across tests.
const newClient = () => {
  const address = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}-${crypto.randomUUID()}`
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    SELF.fetch(`https://example.com${path}`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': address, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  return { call }
}

interface CreationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  authenticatorSelection: { residentKey: string; userVerification: string }
  excludeCredentials: Array<{ id: string }>
}

interface Session {
  userId: string
  token: string
}

const signUp = async (client = newClient(), authenticator?: Awaited<ReturnType<typeof newAuthenticator>>) => {
  const passkey = authenticator ?? (await newAuthenticator())
  const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
  const response = await client.call('/auth/register/verify', await passkey.register(options.challenge))
  expect(response.status).toBe(200)
  return { passkey, session: (await response.json()) as Session, client }
}

const signInChallenge = async (client: ReturnType<typeof newClient>) =>
  ((await (await client.call('/auth/signin/options')).json()) as { challenge: string }).challenge

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

const exercise = {
  id: 'passkey-exercise',
  name: 'Squat',
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'quads',
  targetSets: 3,
  defaults: { reps: 5 },
  isDeleted: false,
  updatedAt: '2026-10-01T12:00:00.000Z'
} satisfies Extract<Row, { table: 'exercises' }>['row']

describe('passkey sign-up and sign-in', () => {
  it('signs up, backs up, signs in on a new phone and restores', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    expect(options.rp).toEqual({ id: RP_ID, name: 'Jimbro' })
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' })
    expect(options.excludeCredentials).toEqual([])
    // Each account's passkey carries the day it was made, so two accounts read apart in a password manager.
    expect(options.user.name).toMatch(/^Jimbro · \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    expect(options.user.displayName).toBe(options.user.name)

    const passkey = await newAuthenticator()
    const registered = await client.call('/auth/register/verify', await passkey.register(options.challenge))
    expect(registered.status).toBe(200)
    const first = (await registered.json()) as Session
    expect(new TextDecoder().decode(fromBase64Url(options.user.id) ?? new Uint8Array())).toBe(first.userId)

    const push = await SELF.fetch('https://example.com/api/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ table: 'exercises', row: exercise }] })
    })
    expect(push.status).toBe(200)

    const signInOptions = await client.call('/auth/signin/options')
    const signIn = (await signInOptions.json()) as { challenge: string; rpId: string; allowCredentials: unknown[] }
    expect(signIn).toMatchObject({ rpId: RP_ID, allowCredentials: [], userVerification: 'required' })
    const signedIn = await client.call('/auth/signin/verify', await passkey.assert(signIn.challenge))
    expect(signedIn.status).toBe(200)
    const second = (await signedIn.json()) as Session
    expect(second.userId).toBe(first.userId)
    expect(second.token).not.toBe(first.token)

    const pull = await SELF.fetch('https://example.com/api/pull?cursor=0', {
      headers: { Authorization: `Bearer ${second.token}` }
    })
    expect(pull.status).toBe(200)
    const page = (await pull.json()) as { rows: Array<Row & { rev: number }> }
    expect(page.rows.map((entry) => entry.row)).toEqual([exercise])
  })

  it('stores only a hash of each token', async () => {
    const { session } = await signUp()
    const stored = await env.jimbro
      .prepare('SELECT token_hash FROM auth_tokens WHERE user_id = ?1')
      .bind(session.userId)
      .all<{ token_hash: string }>()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session.token))
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(stored.results).toEqual([{ token_hash: hex }])
  })

  it('signs in with an RS256 passkey', async () => {
    const { client, passkey, session } = await signUp(newClient(), await newAuthenticator('RS256'))
    const response = await client.call('/auth/signin/verify', await passkey.assert(await signInChallenge(client)))
    expect(response.status).toBe(200)
    expect(((await response.json()) as Session).userId).toBe(session.userId)
  })

  it('makes each sign-up a new account', async () => {
    const one = await signUp()
    const two = await signUp()
    expect(one.session.userId).not.toBe(two.session.userId)
  })

  it('refuses a credential that is already registered, with CORS headers', async () => {
    const { client, passkey, session } = await signUp()
    const countUsers = async () =>
      (await env.jimbro.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n
    const usersBefore = await countUsers()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const response = await client.call('/auth/register/verify', await passkey.register(options.challenge))
    expect(response.status).toBe(409)
    expect(await errorOf(response)).toBe('credential_exists')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN)
    // The batch rolled back, so the refused sign-up left no account behind.
    expect(await countUsers()).toBe(usersBefore)
    const owners = await env.jimbro
      .prepare('SELECT user_id FROM passkeys WHERE id = ?1')
      .bind(passkey.credentialId)
      .all<{ user_id: string }>()
    expect(owners.results).toEqual([{ user_id: session.userId }])

    const auth = { Authorization: `Bearer ${session.token}` }
    const add = (await (await client.call('/api/passkeys/options', undefined, auth)).json()) as CreationOptions
    const again = await client.call('/api/passkeys/verify', await passkey.register(add.challenge), auth)
    expect(again.status).toBe(409)
    expect(await errorOf(again)).toBe('credential_exists')
  })

  it('adds another passkey to the signed-in account, and signs out', async () => {
    const { client, session, passkey } = await signUp()
    const auth = { Authorization: `Bearer ${session.token}` }
    const options = (await (await client.call('/api/passkeys/options', undefined, auth)).json()) as CreationOptions
    expect(options.excludeCredentials.map((credential) => credential.id)).toEqual([passkey.credentialId])
    expect(new TextDecoder().decode(fromBase64Url(options.user.id) ?? new Uint8Array())).toBe(session.userId)

    const other = await newAuthenticator()
    const added = await client.call('/api/passkeys/verify', await other.register(options.challenge), auth)
    expect(added.status).toBe(200)
    expect(await added.json()).toEqual({ ok: true })

    const signedIn = await client.call('/auth/signin/verify', await other.assert(await signInChallenge(client)))
    expect(((await signedIn.json()) as Session).userId).toBe(session.userId)

    const signedOut = await client.call('/api/signout', undefined, auth)
    expect(signedOut.status).toBe(200)
    expect(await signedOut.json()).toEqual({ ok: true })
    const ping = await SELF.fetch('https://example.com/api/ping', { headers: auth })
    expect(ping.status).toBe(401)
  })

  it('adds a passkey only to the account that asked for the challenge', async () => {
    const one = await signUp()
    const two = await signUp()
    const options = (await (
      await one.client.call('/api/passkeys/options', undefined, { Authorization: `Bearer ${one.session.token}` })
    ).json()) as CreationOptions
    const response = await two.client.call(
      '/api/passkeys/verify',
      await (await newAuthenticator()).register(options.challenge),
      { Authorization: `Bearer ${two.session.token}` }
    )
    expect(await errorOf(response)).toBe('invalid_challenge')
  })
})

describe('passkey checks', () => {
  it('answers no other origin', async () => {
    const response = await newClient().call('/auth/register/options', undefined, { Origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(await errorOf(response)).toBe('origin_not_allowed')
  })

  it('takes the RP ID from the dev origin of a local run', async () => {
    const response = await newClient().call('/auth/signin/options', undefined, { Origin: 'http://localhost:5199' })
    expect(((await response.json()) as { rpId: string }).rpId).toBe('localhost')
  })

  it('rejects client data from another origin', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const passkey = await newAuthenticator()
    const response = await client.call(
      '/auth/register/verify',
      await passkey.register(options.challenge, { origin: 'https://evil.example' })
    )
    expect(await errorOf(response)).toBe('wrong_origin')

    const { passkey: registered } = await signUp(client)
    const signIn = await client.call(
      '/auth/signin/verify',
      await registered.assert(await signInChallenge(client), { origin: 'https://evil.example' })
    )
    expect(await errorOf(signIn)).toBe('wrong_origin')
  })

  it('rejects a ceremony embedded in another origin', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const registration = await (await newAuthenticator()).register(options.challenge, { crossOrigin: true })
    expect(await errorOf(await client.call('/auth/register/verify', registration))).toBe('cross_origin')

    const { passkey } = await signUp(client)
    const response = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { crossOrigin: true })
    )
    expect(await errorOf(response)).toBe('cross_origin')
  })

  it('signs in only on the RP ID the passkey was made for', async () => {
    const { client, passkey } = await signUp()
    const local = { Origin: 'http://localhost:5199' }
    const options = (await (await client.call('/auth/signin/options', undefined, local)).json()) as {
      challenge: string
    }
    const body = await passkey.assert(options.challenge, { origin: 'http://localhost:5199', rpId: 'localhost' })
    const response = await client.call('/auth/signin/verify', body, local)
    expect(await errorOf(response)).toBe('wrong_rp')
  })

  it('rejects a reused challenge', async () => {
    const { client, passkey } = await signUp()
    const body = await passkey.assert(await signInChallenge(client))
    expect((await client.call('/auth/signin/verify', body)).status).toBe(200)
    const again = await client.call('/auth/signin/verify', body)
    expect(await errorOf(again)).toBe('invalid_challenge')
  })

  it('rejects an expired challenge', async () => {
    const { client, passkey } = await signUp()
    const challenge = await signInChallenge(client)
    await env.jimbro.prepare('UPDATE auth_challenges SET expires_at = 0 WHERE challenge = ?1').bind(challenge).run()
    const response = await client.call('/auth/signin/verify', await passkey.assert(challenge))
    expect(await errorOf(response)).toBe('invalid_challenge')
  })

  it('rejects a challenge issued for another step', async () => {
    const { client, passkey } = await signUp()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const response = await client.call('/auth/signin/verify', await passkey.assert(options.challenge))
    expect(await errorOf(response)).toBe('invalid_challenge')
  })

  it('rejects the wrong client data type', async () => {
    const { client, passkey } = await signUp()
    const response = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { type: 'webauthn.create' })
    )
    expect(await errorOf(response)).toBe('wrong_type')
  })

  it('rejects a bad signature', async () => {
    const { client, passkey } = await signUp()
    const response = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { tamper: true })
    )
    expect(response.status).toBe(401)
    expect(await errorOf(response)).toBe('bad_signature')
  })

  it('rejects a signature from another key for a known credential', async () => {
    const { client, passkey } = await signUp()
    const impostor = await newAuthenticator()
    const body = await impostor.assert(await signInChallenge(client))
    const response = await client.call('/auth/signin/verify', { ...body, id: passkey.credentialId })
    expect(await errorOf(response)).toBe('bad_signature')
  })

  it('rejects an unknown credential', async () => {
    const client = newClient()
    const response = await client.call(
      '/auth/signin/verify',
      await (await newAuthenticator()).assert(await signInChallenge(client))
    )
    expect(await errorOf(response)).toBe('unknown_credential')
  })

  it('rejects authenticator data for another RP ID', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const registration = await (await newAuthenticator()).register(options.challenge, { rpId: 'evil.example' })
    expect(await errorOf(await client.call('/auth/register/verify', registration))).toBe('wrong_rp')

    const { passkey } = await signUp(client)
    const response = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { rpId: 'evil.example' })
    )
    expect(await errorOf(response)).toBe('wrong_rp')
  })

  it('requires user verification', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const registration = await (await newAuthenticator()).register(options.challenge, { flags: UP })
    expect(await errorOf(await client.call('/auth/register/verify', registration))).toBe('user_not_verified')

    const { passkey } = await signUp(client)
    const response = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { flags: UP })
    )
    expect(await errorOf(response)).toBe('user_not_verified')
  })

  it('requires user presence', async () => {
    const { client, passkey } = await signUp()
    const response = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { flags: UV })
    )
    expect(await errorOf(response)).toBe('user_not_present')
  })

  it('rejects a sign count that went back', async () => {
    const { client, passkey } = await signUp()
    const forward = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { signCount: 5 })
    )
    expect(forward.status).toBe(200)
    const back = await client.call(
      '/auth/signin/verify',
      await passkey.assert(await signInChallenge(client), { signCount: 3 })
    )
    expect(await errorOf(back)).toBe('sign_count')
  })

  it('rejects a registration whose credential ID differs from the authenticator data', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const registration = await (await newAuthenticator()).register(options.challenge)
    const response = await client.call('/auth/register/verify', {
      ...registration,
      id: toBase64Url(new Uint8Array(16))
    })
    expect(await errorOf(response)).toBe('credential_mismatch')
  })

  it('rejects a public key that is not one', async () => {
    const client = newClient()
    const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
    const registration = await (await newAuthenticator()).register(options.challenge)
    const response = await client.call('/auth/register/verify', { ...registration, publicKey: 'AAAA' })
    expect(await errorOf(response)).toBe('unsupported_public_key')
  })

  it('limits the calls each address makes a minute', async () => {
    const client = newClient()
    const statuses: number[] = []
    for (let call = 0; call < 21; call++) statuses.push((await client.call('/auth/signin/options')).status)
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})

describe('abuse limits', () => {
  const pushAs = (token: string, rows: unknown[], target = (request: Request) => SELF.fetch(request)) =>
    target(
      new Request('https://example.com/api/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      })
    )

  const named = (id: string) => ({ table: 'exercises', row: { ...exercise, id } })

  it('caps the rows one user stores, and still takes edits of stored rows at the cap', async () => {
    const { session } = await signUp()
    const capped = (request: Request) => worker.fetch(request, { ...env, AUTH_TOKENS: '{}', ROW_CAP: '3' })
    expect((await pushAs(session.token, [named('a'), named('b')], capped)).status).toBe(200)
    expect((await pushAs(session.token, [named('a'), named('c')], capped)).status).toBe(200)

    const full = await pushAs(session.token, [named('d')], capped)
    expect(full.status).toBe(413)
    expect(await full.json()).toEqual({ error: 'row_limit', cap: 3 })

    const edit = await pushAs(
      session.token,
      [{ table: 'exercises', row: { ...exercise, id: 'b', name: 'Front squat' } }],
      capped
    )
    expect(edit.status).toBe(200)
  })

  it('limits the pushes each user makes a minute', async () => {
    const { session } = await signUp()
    const statuses: number[] = []
    for (let call = 0; call < 61; call++) statuses.push((await pushAs(session.token, [])).status)
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
  })
})
