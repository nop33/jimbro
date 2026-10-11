import { describe, it, expect } from 'vite-plus/test'
import { formatShortDate, getSimpleDate, parseSimpleDate } from '../src/dateUtils'

const withTimezone = <T>(timezone: string, callback: () => T): T => {
  const originalTimezone = process.env.TZ
  process.env.TZ = timezone

  try {
    return callback()
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTimezone
    }
  }
}

describe('getSimpleDate', () => {
  it('formats dates using the local calendar day', () => {
    expect(getSimpleDate(new Date(2026, 4, 18, 0, 30))).toBe('2026-05-18')
  })

  it('does not shift early morning dates backwards in UTC+8', () => {
    withTimezone('Asia/Singapore', () => {
      const earlyMorning = new Date(2026, 4, 18, 0, 30)

      expect(earlyMorning.toISOString().startsWith('2026-05-17')).toBe(true)
      expect(getSimpleDate(earlyMorning)).toBe('2026-05-18')
    })
  })
})

describe('parseSimpleDate', () => {
  it('parses date-only strings as local calendar dates', () => {
    const date = parseSimpleDate('2026-05-18')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(4)
    expect(date.getDate()).toBe(18)
  })
})

describe('formatShortDate', () => {
  it('leaves the year out for a date in the current year', () => {
    expect(formatShortDate(new Date(2026, 9, 1), new Date(2026, 9, 8))).not.toContain('2026')
  })

  it('keeps the year for a date in another year', () => {
    expect(formatShortDate(new Date(2025, 11, 30), new Date(2026, 0, 2))).toContain('2025')
  })
})
