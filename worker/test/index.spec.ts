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

  it('counts zero D1 statements on 401 when the caller asks', async () => {
    const res = await SELF.fetch('https://example.com/api/pull', {
      headers: { 'x-d1-count': '1' }
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('x-d1-statements')).toBe('0')
    expect(res.headers.get('x-d1-batches')).toBe('0')
  })
})

describe('routing', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await SELF.fetch('https://example.com/api/nonexistent', {
      headers: { Authorization: 'Bearer test-token-123' }
    })
    expect(res.status).toBe(404)
  })
})
