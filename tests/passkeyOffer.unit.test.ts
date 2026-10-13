import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { passkeyOfferDue, readSnoozedUntil, snoozePasskeyOffer } from '../src/pages/gymtime/passkeyOffer'

const NOW = new Date('2026-10-12T18:00:00.000Z')
const due = (overrides: Partial<Parameters<typeof passkeyOfferDue>[0]> = {}) =>
  passkeyOfferDue({ backup: null, supported: true, snoozedUntil: null, now: NOW, ...overrides })

// A localStorage for Node, which has none.
const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('passkeyOfferDue', () => {
  it('offers a passkey to a device with no backup, and to one backed up with a token', () => {
    expect(due()).toBe(true)
    expect(due({ backup: 'token' })).toBe(true)
  })

  it('never offers one to a device a passkey backs up, or where the browser has no passkeys', () => {
    expect(due({ backup: 'passkey' })).toBe(false)
    expect(due({ supported: false })).toBe(false)
  })

  it('waits out the snooze', () => {
    expect(due({ snoozedUntil: '2026-10-13T00:00:00.000Z' })).toBe(false)
    expect(due({ snoozedUntil: '2026-10-12T18:00:00.000Z' })).toBe(true)
    expect(due({ snoozedUntil: 'not a date' })).toBe(true)
  })
})

describe('snoozePasskeyOffer', () => {
  it('snoozes the offer for 14 days', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    snoozePasskeyOffer(NOW)
    expect(readSnoozedUntil()).toBe('2026-10-26T18:00:00.000Z')
    expect(due({ snoozedUntil: readSnoozedUntil(), now: new Date('2026-10-26T17:59:59.000Z') })).toBe(false)
    expect(due({ snoozedUntil: readSnoozedUntil(), now: new Date('2026-10-26T18:00:00.000Z') })).toBe(true)
  })

  it('offers again after every workout where storage throws', () => {
    const failing = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: failing, setItem: failing })
    expect(() => snoozePasskeyOffer(NOW)).not.toThrow()
    expect(readSnoozedUntil()).toBeNull()
  })
})
