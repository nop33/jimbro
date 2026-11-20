import { describe, expect, test } from 'vite-plus/test'
import { inChristmasSeason } from '../src/features/season'
import { adventDoors, adventShown, doorFact } from '../src/pages/home/advent'
import type { WorkoutSession } from '../src/db/types'

const workout = (date: string, sets: Array<{ preset: 'lifting'; reps: number; weight: number }>): WorkoutSession =>
  ({
    id: date,
    date,
    programId: 'p',
    location: '',
    status: 'completed',
    updatedAt: `${date}T10:00:00.000Z`,
    exercises: [{ id: 'e', name: 'Squat', kind: 'lifting', preset: 'reps-weight', muscle: 'quads', sets }]
  }) as unknown as WorkoutSession

describe('the Christmas season', () => {
  test('runs from Dec 1 to Jan 6', () => {
    expect(inChristmasSeason('2026-11-30')).toBe(false)
    expect(inChristmasSeason('2026-12-01')).toBe(true)
    expect(inChristmasSeason('2026-12-31')).toBe(true)
    expect(inChristmasSeason('2027-01-06')).toBe(true)
    expect(inChristmasSeason('2027-01-07')).toBe(false)
  })

  test('shows the advent calendar from Dec 1 to Boxing Day', () => {
    expect(adventShown('2026-11-30')).toBe(false)
    expect(adventShown('2026-12-01')).toBe(true)
    expect(adventShown('2026-12-26')).toBe(true)
    expect(adventShown('2026-12-27')).toBe(false)
  })
})

describe('advent doors', () => {
  test('a workout opens its day, and the days before without one stay shut', () => {
    const doors = adventDoors([workout('2026-12-02', []), workout('2025-12-03', [])], '2026-12-04')
    expect(doors.map((door) => door.state).slice(0, 6)).toEqual(['missed', 'open', 'missed', 'today', 'shut', 'shut'])
  })

  test("Christmas Eve's door opens with any workout in Christmas week", () => {
    const doors = adventDoors([workout('2026-12-22', [])], '2026-12-25')
    expect(doors[23].state).toBe('open')
    expect(doors[21].state).toBe('open')
  })

  test('tells what was behind a door from the weight lifted', () => {
    const doors = adventDoors(
      [
        workout(
          '2026-12-11',
          Array.from({ length: 10 }, () => ({ preset: 'lifting', reps: 10, weight: 59 }))
        )
      ],
      '2026-12-16'
    )
    expect(doorFact(doors[10])).toEqual({
      title: 'You lifted 5.9 tonnes.',
      line: "That's 118,000 gingerbread men. Don't eat them all."
    })
    const empty = adventDoors([workout('2026-12-08', [])], '2026-12-16')[7]
    expect(doorFact(empty).title).toBe('You showed up.')
  })
})
