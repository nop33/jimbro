import { describe, it, expect } from 'vitest'
import { getWeekOfYear } from '../src/dateUtils'

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
