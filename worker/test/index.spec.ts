import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

const AUTH_HEADER = {
  Authorization: `Bearer ${
    JSON.parse(env.AUTH_TOKENS as string).constructor ? Object.keys(JSON.parse(env.AUTH_TOKENS))[0] : ''
  }`
}

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

describe('PUT /api/snapshot', () => {
  const validPayload = JSON.stringify({
    version: 2,
    exportDate: '2026-04-12',
    stores: {
      exercises: [{ id: 'e1', name: 'Bench press' }],
      programs: [{ id: 'p1', name: 'Push day' }],
      workoutSessions: [{ id: 's1', date: '2026-04-12' }]
    }
  })

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: validPayload
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: 'not json'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
  })

  it('returns 400 for wrong shape', async () => {
    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2 })
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_shape' })
  })

  it('returns 400 when a row is missing id', async () => {
    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        exportDate: '2026-04-12',
        stores: {
          exercises: [{ name: 'no id' }],
          programs: [{ id: 'p1' }],
          workoutSessions: [{ id: 's1' }]
        }
      })
    })
    expect(res.status).toBe(400)
  })

  it('stores snapshot and returns counts on success', async () => {
    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: validPayload
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; timestamp: string; counts: Record<string, number> }
    expect(body.ok).toBe(true)
    expect(body.timestamp).toBeTruthy()
    expect(body.counts).toEqual({ exercises: 1, programs: 1, workoutSessions: 1 })
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
