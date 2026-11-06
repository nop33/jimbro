import { describe, expect, it } from 'vite-plus/test'
import { alertsOfferDue } from '../src/features/breakTimer/alertsOffer'

const now = new Date('2026-11-06T12:00:00Z')
const due = (overrides: Partial<Parameters<typeof alertsOfferDue>[0]> = {}) =>
  alertsOfferDue({
    supported: true,
    hasAccount: true,
    on: false,
    permission: 'default',
    snoozedUntil: null,
    now,
    ...overrides
  })

describe('alertsOfferDue', () => {
  it('offers the alerts while they are off', () => {
    expect(due()).toBe(true)
    expect(due({ permission: 'granted' })).toBe(true)
  })

  it('offers nothing without push, without an account, once on, or when notifications are blocked', () => {
    expect(due({ supported: false })).toBe(false)
    expect(due({ hasAccount: false })).toBe(false)
    expect(due({ on: true })).toBe(false)
    expect(due({ permission: 'denied' })).toBe(false)
  })

  it('stays away until the snooze ends', () => {
    expect(due({ snoozedUntil: '2026-11-20T12:00:00Z' })).toBe(false)
    expect(due({ snoozedUntil: '2026-11-06T12:00:00Z' })).toBe(true)
    expect(due({ snoozedUntil: 'garbage' })).toBe(true)
  })
})
