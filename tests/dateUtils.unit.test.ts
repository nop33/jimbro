import { describe, it, expect } from 'vite-plus/test'
import { getSimpleDate, getWeekOfYear, getWeeksKeysFromDateToNow, parseSimpleDate } from '../src/dateUtils'

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

describe('getWeekOfYear', () => {
  it('returns correctly formatted week string for early January', () => {
    // Jan 1, 2024 is Monday. Since Jan 1 is 1st day, it should be week 1.
    // oneJan.getDay() for 2024 is 1. numberOfDays is 0.
    // weekNumber = Math.ceil((1 + 0) / 7) = Math.ceil(1/7) = 1.
    const date = new Date(2024, 0, 1) // Jan 1, 2024
    expect(getWeekOfYear(date)).toBe('2024-W1')
  })

  it('handles regular dates in the middle of the year', () => {
    // For June 15, 2024
    const date = new Date(2024, 5, 15) // June 15, 2024
    expect(getWeekOfYear(date)).toBe('2024-W24')
  })

  it('handles leap years correctly', () => {
    // 2024 is a leap year. Feb 29, 2024
    const date = new Date(2024, 1, 29)
    // Jan has 31 days + 28 days of Feb = 59.
    // Jan 1, 2024 was Monday (day 1).
    // numberOfDays = 59.
    // Math.ceil((1 + 59) / 7) = Math.ceil(60 / 7) = Math.ceil(8.57) = 9.
    expect(getWeekOfYear(date)).toBe('2024-W9')
  })

  it('handles week 53 rollover logic', () => {
    // The current implementation of `getWeekOfYear`:
    // weekNumber === 53 ? { year: year + 1, week: 1 } : { year, week: weekNumber }

    // Let's find a date that hits week 53.
    // Dec 31, 2023. Jan 1, 2023 was Sunday (0).
    // numberOfDays = 364.
    // Math.ceil((0 + 364) / 7) = Math.ceil(364 / 7) = 52.
    // Dec 31, 2022. Jan 1, 2022 was Saturday (6).
    // numberOfDays = 364.
    // Math.ceil((6 + 364) / 7) = Math.ceil(370 / 7) = Math.ceil(52.85) = 53.

    const date = new Date(2022, 11, 31) // Dec 31, 2022
    // It should hit week 53 and roll over to 2023-W1
    expect(getWeekOfYear(date)).toBe('2023-W1')
  })

  it('returns correctly for December 31 on non-week-53 years', () => {
    // Dec 31, 2023.
    const date = new Date(2023, 11, 31)
    expect(getWeekOfYear(date)).toBe('2023-W52')
  })
})

describe('getWeeksKeysFromDateToNow', () => {
  it('includes the current week even when the first date is later in the week', () => {
    const firstWorkoutDate = new Date(2026, 4, 12) // Tuesday, Week 20
    const today = new Date(2026, 4, 18) // Monday, Week 21

    expect(getWeeksKeysFromDateToNow(firstWorkoutDate, today)).toEqual(['2026-W20', '2026-W21'])
  })

  it('includes the current week before 8am in UTC+8', () => {
    withTimezone('Asia/Singapore', () => {
      const earlyMorning = new Date(2026, 4, 18, 0, 30)
      const today = getSimpleDate(earlyMorning)

      expect(earlyMorning.toISOString().startsWith('2026-05-17')).toBe(true)
      expect(getWeeksKeysFromDateToNow(parseSimpleDate(today), earlyMorning)).toEqual(['2026-W21'])
    })
  })
})

describe('getSimpleDate', () => {
  it('formats dates using the local calendar day', () => {
    expect(getSimpleDate(new Date(2026, 4, 18, 0, 30))).toBe('2026-05-18')
  })

  it('does not shift early morning dates backwards in UTC+8', () => {
    withTimezone('Asia/Singapore', () => {
      const earlyMorning = new Date(2026, 4, 18, 0, 30)

      expect(earlyMorning.toISOString().startsWith('2026-05-17')).toBe(true)
      expect(getSimpleDate(earlyMorning)).toBe('2026-05-18')
      expect(getWeekOfYear(earlyMorning)).toBe('2026-W21')
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
