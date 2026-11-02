import { env, fetchMock, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from '../../src/sync/base64url'
import { encryptPayload, parsePushTarget, vapidAuthorization, type PushTarget } from '../src/webPush'

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
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

// A browser's side of a subscription: its ECDH key pair and auth secret, and the decryption RFC 8291 has it run.
const makeBrowser = async (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits'
  ])) as CryptoKeyPair
  const publicKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const target: PushTarget = { endpoint, keys: { p256dh: toBase64Url(publicKey), auth: toBase64Url(auth) } }
  const decrypt = async (body: Uint8Array) => {
    const salt = body.slice(0, 16)
    const idLength = body[20]
    const senderPublic = body.slice(21, 21 + idLength)
    const sender = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: sender } as unknown as SubtleCryptoDeriveKeyAlgorithm,
        pair.privateKey,
        256
      )
    )
    const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), publicKey, senderPublic), 32)
    const key = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)
    const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, body.slice(21 + idLength))
    )
    expect(plain.at(-1)).toBe(2)
    return new TextDecoder().decode(plain.slice(0, -1))
  }
  return { target, decrypt }
}

const vapid = () => ({
  publicKey: env.VAPID_PUBLIC_KEY!,
  privateKey: env.VAPID_PRIVATE_KEY!,
  subject: env.VAPID_SUBJECT!
})

const call = (path: string, body?: unknown, token = 'test-token-123') =>
  SELF.fetch(`https://api.example.com${path}`, {
    method: body === undefined && path === '/api/break-alerts' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

const alarmFor = (userId: string) => env.BREAK_ALARMS.get(env.BREAK_ALARMS.idFromName(userId))

describe('web push', () => {
  it('encrypts a payload the browser decrypts', async () => {
    const browser = await makeBrowser()
    const body = await encryptPayload(browser.target, '{"title":"Break over"}')
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
    expect(await browser.decrypt(body)).toBe('{"title":"Break over"}')
  })

  it("signs a VAPID token for the push service's origin with the worker's key", async () => {
    const now = Date.UTC(2026, 9, 31, 12)
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid(), now)
    const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(key).toBe(env.VAPID_PUBLIC_KEY)
    const [head, claims, signature] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(head)!))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)!))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'mailto:test@example.com'
    })
    const publicKey = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(env.VAPID_PUBLIC_KEY!)!,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64Url(signature)!,
      utf8(`${head}.${claims}`)
    )
    expect(valid).toBe(true)
  })

  it('takes subscriptions only on the push services browsers use', async () => {
    const { target } = await makeBrowser()
    expect(parsePushTarget(target)).toEqual(target)
    for (const endpoint of [
      'https://web.push.apple.com/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc'
    ]) {
      expect(parsePushTarget({ ...target, endpoint })).not.toBeNull()
    }
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example.com/abc',
      'https://fcm.googleapis.com.evil.example.com/abc',
      'https://localhost/abc'
    ]) {
      expect(parsePushTarget({ ...target, endpoint })).toBeNull()
    }
    expect(parsePushTarget({ ...target, keys: { ...target.keys, auth: 'AAAA' } })).toBeNull()
  })
})

describe('break alerts', () => {
  beforeAll(() => {
    fetchMock.activate()
    fetchMock.disableNetConnect()
  })

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors()
  })

  it("gives the app the worker's public key, and only with a token", async () => {
    const response = await call('/api/break-alerts')
    expect(await response.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY })
    expect((await call('/api/break-alerts', undefined, 'wrong')).status).toBe(401)
  })

  it('schedules nothing for a user without a subscription', async () => {
    await call('/api/break-alerts/unsubscribe', {})
    const response = await call('/api/break-alerts/schedule', {
      endsAt: Date.now() + 90_000,
      title: 'Break over',
      body: 'Next: Squat',
      url: '/gymtime/?id=1'
    })
    expect(await response.json()).toEqual({ scheduled: false })
  })

  it('refuses a break that ends too far ahead, or opens another site', async () => {
    const alert = { endsAt: Date.now() + 90_000, title: 'Break over', body: '', url: '/gymtime/' }
    expect((await call('/api/break-alerts/schedule', { ...alert, endsAt: Date.now() + 2 * 3600_000 })).status).toBe(400)
    expect((await call('/api/break-alerts/schedule', { ...alert, url: '//evil.example.com' })).status).toBe(400)
    expect((await call('/api/break-alerts/schedule', { ...alert, url: 'https://evil.example.com' })).status).toBe(400)
    expect((await call('/api/break-alerts/subscribe', { endpoint: 'https://evil.example.com/x' })).status).toBe(400)
  })

  it('pushes the alert when the break ends, and nothing once it is cancelled', async () => {
    const browser = await makeBrowser('https://fcm.googleapis.com/fcm/send/nikos')
    expect((await call('/api/break-alerts/subscribe', browser.target)).status).toBe(200)
    const alert = { title: 'Break over', body: 'Next: Squat', url: '/gymtime/?id=1' }
    const endsAt = Date.now() + 90_000
    expect(await (await call('/api/break-alerts/schedule', { endsAt, ...alert })).json()).toEqual({ scheduled: true })
    const stub = alarmFor('nikos')
    expect(await runInDurableObject(stub, (_, state) => state.storage.getAlarm())).toBe(endsAt)

    // The mock hands over the body as text, so this checks the request, and the encryption test above its body.
    let headers: Record<string, string> | undefined
    fetchMock
      .get('https://fcm.googleapis.com')
      .intercept({ path: '/fcm/send/nikos', method: 'POST' })
      .reply(201, (options) => {
        headers = options.headers as Record<string, string>
        return ''
      })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(headers?.['content-encoding']).toBe('aes128gcm')
    expect(headers?.ttl).toBe('60')
    expect(headers?.urgency).toBe('high')
    expect(headers?.authorization).toMatch(/^vapid t=.+, k=/)

    // A cancelled break leaves no alarm, so nothing is pushed.
    await call('/api/break-alerts/schedule', { endsAt: Date.now() + 90_000, ...alert })
    await call('/api/break-alerts/cancel', {})
    expect(await runDurableObjectAlarm(stub)).toBe(false)
  })

  it('forgets a subscription the push service no longer knows', async () => {
    const browser = await makeBrowser('https://fcm.googleapis.com/fcm/send/gone')
    await call('/api/break-alerts/subscribe', browser.target)
    await call('/api/break-alerts/schedule', { endsAt: Date.now() + 1000, title: 'Break over', body: '', url: '/' })
    fetchMock.get('https://fcm.googleapis.com').intercept({ path: '/fcm/send/gone', method: 'POST' }).reply(410, '')
    expect(await runDurableObjectAlarm(alarmFor('nikos'))).toBe(true)
    const response = await call('/api/break-alerts/schedule', {
      endsAt: Date.now() + 1000,
      title: 'Break over',
      body: '',
      url: '/'
    })
    expect(await response.json()).toEqual({ scheduled: false })
  })
})
