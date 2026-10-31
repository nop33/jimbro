import { fromBase64Url, toBase64Url } from '../../src/sync/base64url'

// Web Push on WebCrypto alone: the payload is encrypted for the browser as RFC 8291 says (aes128gcm), and the request
// carries a VAPID JWT (RFC 8292) signed with the worker's key, so the push service knows who sends it.

// What PushSubscription.toJSON() gives the app: the push service's URL and the browser's keys, as base64url.
export interface PushTarget {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// The worker's VAPID key pair: the public key as the 65-byte uncompressed P-256 point, and the private scalar d, both
// base64url, and the contact the push services may write to.
export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

// The push services the browsers Jimbro runs on use. The worker sends to no other host, so an endpoint can't point it
// anywhere else.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*mozilla\.com$/]
const PUSH_HOSTS_WINDOWS = /^[a-z0-9-]+\.notify\.windows\.com$/

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

// The subscription, or null unless it names an https endpoint on a known push service and keys of the right sizes.
export const parsePushTarget = (value: unknown): PushTarget | null => {
  if (typeof value !== 'object' || value === null) return null
  const { endpoint, keys } = value as Record<string, unknown>
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || typeof keys !== 'object' || keys === null) return null
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (!PUSH_HOSTS.some((host) => host.test(url.hostname)) && !PUSH_HOSTS_WINDOWS.test(url.hostname)) return null
  const { p256dh, auth } = keys as Record<string, unknown>
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null
  const publicKey = fromBase64Url(p256dh)
  const secret = fromBase64Url(auth)
  if (publicKey?.length !== 65 || publicKey[0] !== 4 || secret?.length !== 16) return null
  return { endpoint, keys: { p256dh, auth } }
}

const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array, bytes: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: info as Uint8Array<ArrayBuffer> },
      key,
      bytes * 8
    )
  )
}

// The body of one push: the payload encrypted for the subscription's keys, in a single aes128gcm record. salt and the
// sender's key pair are fresh for every push unless a test passes its own.
export const encryptPayload = async (
  target: PushTarget,
  payload: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; sender: CryptoKeyPair }
) => {
  const receiverPublic = fromBase64Url(target.keys.p256dh)!
  const authSecret = fromBase64Url(target.keys.auth)!
  const sender =
    fixed?.sender ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const senderPublic = new Uint8Array((await crypto.subtle.exportKey('raw', sender.publicKey)) as ArrayBuffer)
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      // The standard name of the field is public, which the workers types spell $public.
      { name: 'ECDH', public: receiverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      sender.privateKey,
      256
    )
  )

  const keyInfo = concat(utf8('WebPush: info\0'), receiverPublic, senderPublic)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  // One record, so its padding delimiter is 2, and the record size only needs to hold it.
  const plaintext = concat(utf8(payload), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext))

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, 4096)
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, ciphertext)
}

const importVapidKey = (keys: VapidKeys) => {
  const publicKey = fromBase64Url(keys.publicKey)
  if (publicKey?.length !== 65) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33)),
    d: keys.privateKey,
    ext: true
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

// The Authorization header for a push to endpoint: a JWT for the push service's origin, valid for 12 hours.
export const vapidAuthorization = async (endpoint: string, keys: VapidKeys, now: number) => {
  const encode = (value: unknown) => toBase64Url(utf8(JSON.stringify(value)))
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: keys.subject
  })}`
  // WebCrypto signs ECDSA as r || s, which is what a JWT's ES256 signature is.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importVapidKey(keys),
    utf8(unsigned)
  )
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`
}

// Sends one push. Resolves to 'gone' when the push service no longer knows the subscription, so the caller forgets it.
export const sendPush = async (target: PushTarget, payload: string, keys: VapidKeys, now = Date.now()) => {
  const response = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys, now),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // A break alert is worth nothing a minute late, and should wake the phone.
      TTL: '60',
      Urgency: 'high'
    },
    body: await encryptPayload(target, payload)
  })
  if (response.status === 404 || response.status === 410) return 'gone'
  if (!response.ok) throw new Error(`push failed: ${response.status} ${await response.text()}`)
  return 'sent'
}
