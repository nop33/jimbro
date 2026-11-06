import { SELF } from 'cloudflare:test'
import { expect } from 'vitest'
import { toBase64Url } from '../../src/sync/base64url'

// A software authenticator: it makes the same bytes a phone's passkey would, with a key generated here, so these tests
// run the worker's checks on real signatures.

export const APP_ORIGIN = 'https://jimbro.nop33.com'
export const RP_ID = 'jimbro.nop33.com'

export const UP = 0x01
export const UV = 0x04
export const AT = 0x40

export const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data))
export const utf8 = (text: string) => new TextEncoder().encode(text)
export const concat = (...parts: Uint8Array[]) => {
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

export const newAuthenticator = async (algorithm: Algorithm = 'ES256') => {
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
export const newClient = () => {
  const address = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}-${crypto.randomUUID()}`
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    SELF.fetch(`https://example.com${path}`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': address, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  return { call }
}

export interface CreationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  authenticatorSelection: { residentKey: string; userVerification: string }
  excludeCredentials: Array<{ id: string }>
}

export interface Session {
  userId: string
  token: string
}

export const signUp = async (client = newClient(), authenticator?: Awaited<ReturnType<typeof newAuthenticator>>) => {
  const passkey = authenticator ?? (await newAuthenticator())
  const options = (await (await client.call('/auth/register/options')).json()) as CreationOptions
  const response = await client.call('/auth/register/verify', await passkey.register(options.challenge))
  expect(response.status).toBe(200)
  return { passkey, session: (await response.json()) as Session, client }
}

export const signInChallenge = async (client: ReturnType<typeof newClient>) =>
  ((await (await client.call('/auth/signin/options')).json()) as { challenge: string }).challenge

export const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
