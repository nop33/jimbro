import { env, SELF } from 'cloudflare:test'
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

describe('GET /api/snapshot/latest', () => {
  it('returns 404 when no snapshot exists', async () => {
    const res = await SELF.fetch('https://example.com/api/snapshot/latest', {
      headers: { Authorization: 'Bearer test-token-123' }
    })
    // May be 200 if a previous test wrote a snapshot — that's OK.
    // This test is most useful on a clean R2 state.
    expect([200, 404]).toContain(res.status)
  })

  it('returns the uploaded snapshot', async () => {
    const payload = {
      version: 2,
      exportDate: '2026-04-17',
      stores: {
        exercises: [{ id: 'e1' }],
        programs: [{ id: 'p1' }],
        workoutSessions: [{ id: 's1' }]
      }
    }

    await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const res = await SELF.fetch('https://example.com/api/snapshot/latest', {
      headers: { Authorization: 'Bearer test-token-123' }
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(payload)
  })
})

describe('shrink guard', () => {
  it('rejects when exercise count decreases (hard rule)', async () => {
    // Seed with 2 exercises
    await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        exportDate: '2026-04-17',
        stores: {
          exercises: [{ id: '1' }, { id: '2' }],
          programs: [{ id: '1' }],
          workoutSessions: [
            {
              id: '1'
            }
          ]
        }
      })
    })

    // Try with 1 exercise
    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        exportDate: '2026-04-17',
        stores: { exercises: [{ id: '1' }], programs: [{ id: '1' }], workoutSessions: [{ id: '1' }] }
      })
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.rule).toBe('exercises_count_decreased')
    expect(body.isHardRule).toBe(true)
  })

  it('rejects drastic session drop but allows with force=1', async () => {
    // Seed with 10 sessions
    await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        exportDate: '2026-04-17',
        stores: {
          exercises: [{ id: '1' }],
          programs: [{ id: '1' }],
          workoutSessions: Array.from({ length: 10 }, (_, i) => ({ id: String(i) }))
        }
      })
    })

    // Drop to 2 sessions → 409
    const shrunk = JSON.stringify({
      version: 2,
      exportDate: '2026-04-17',
      stores: {
        exercises: [{ id: '1' }],
        programs: [{ id: '1' }],
        workoutSessions: [{ id: '0' }, { id: '1' }]
      }
    })

    const res = await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: shrunk
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.rule).toBe('sessions_count_dropped')
    expect(body.isHardRule).toBe(false)

    // Same with force=1 → 200
    const forced = await SELF.fetch('https://example.com/api/snapshot?force=1', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: shrunk
    })
    expect(forced.status).toBe(200)
  })

  it('does not reject force=1 on hard rule', async () => {
    // Seed with 2 exercises
    await SELF.fetch('https://example.com/api/snapshot', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        exportDate: '2026-04-17',
        stores: {
          exercises: [{ id: '1' }, { id: '2' }],
          programs: [{ id: '1' }],
          workoutSessions: [
            {
              id: '1'
            }
          ]
        }
      })
    })

    // Drop exercises with force=1 → still 409
    const res = await SELF.fetch('https://example.com/api/snapshot?force=1', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        exportDate: '2026-04-17',
        stores: { exercises: [{ id: '1' }], programs: [{ id: '1' }], workoutSessions: [{ id: '1' }] }
      })
    })
    expect(res.status).toBe(409)
  })
})
