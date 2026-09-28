import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/index'

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

describe('cors', () => {
  const preflight = (origin: string) =>
    new Request('https://example.com/api/pull', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' }
    })

  it('allows the app origin', async () => {
    const res = await SELF.fetch(preflight('https://jimbro.nop33.com'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://jimbro.nop33.com')
  })

  it('allows the dev origin the local run passes in', async () => {
    const res = await SELF.fetch(preflight('http://localhost:5199'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5199')
  })

  it('does not allow any other origin', async () => {
    const res = await SELF.fetch(preflight('http://localhost:5174'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows no dev origin when none is set, as in production', async () => {
    const res = await worker.fetch(preflight('http://localhost:5199'), {
      ...env,
      AUTH_TOKENS: '{}',
      DEV_ORIGIN: undefined
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
