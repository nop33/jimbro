import { SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

describe('auth', () => {
  it('returns 401 with no token', async () => {
    const res = await SELF.fetch('https://example.com/api/ping')
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong token', async () => {
    const res = await SELF.fetch('https://example.com/api/ping', {
      headers: { Authorization: 'Bearer wrong-token' }
    })
    expect(res.status).toBe(401)
  })

  it('returns userId with valid token', async () => {
    const res = await SELF.fetch('https://example.com/api/ping', {
      headers: { Authorization: 'Bearer test-token-123' }
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, userId: 'nikos' })
  })
})
