import { describe, expect, it } from 'vite-plus/test'
import {
  normalizeMuscle,
  upgradeExerciseRecord,
  upgradeProgramRecord,
  upgradeWorkoutSessionRecord
} from '../src/db/schemaUpgrade'
import type { Exercise } from '../src/db/stores/exercisesStore'

const now = '2026-08-29T12:00:00.000Z'

describe('schemaUpgrade', () => {
  it('maps legacy muscle labels to slugs', () => {
    expect(normalizeMuscle('Quads')).toBe('quads')
    expect(normalizeMuscle('triceps')).toBe('triceps')
    expect(normalizeMuscle('unknown')).toBe('core')
  })

  it('upgrades a v2 exercise record', () => {
    const upgraded = upgradeExerciseRecord(
      {
        id: 'ex-1',
        name: 'Bench press',
        muscle: 'Chest',
        sets: 4,
        reps: 8
      },
      now
    )

    expect(upgraded).toEqual({
      id: 'ex-1',
      name: 'Bench press',
      muscle: 'chest',
      targetSets: 4,
      targetReps: 8,
      isDeleted: false,
      isRehab: false,
      updatedAt: now
    })
  })

  it('upgrades a v2 program record', () => {
    const upgraded = upgradeProgramRecord(
      {
        id: 'p-1',
        name: 'Push day',
        exercises: ['ex-1']
      },
      now
    )

    expect(upgraded.isDeleted).toBe(false)
    expect(upgraded.updatedAt).toBe(now)
    expect(upgraded.exercises).toEqual(['ex-1'])
  })

  it('snapshots session exercises from the catalog and preserves completed status targets', () => {
    const catalog = new Map<string, Exercise>([
      [
        'ex-1',
        {
          id: 'ex-1',
          name: 'Bench press',
          muscle: 'chest',
          targetSets: 5,
          targetReps: 8,
          isDeleted: false,
          isRehab: false,
          updatedAt: now
        }
      ]
    ])

    const upgraded = upgradeWorkoutSessionRecord(
      {
        id: 's-1',
        date: '2026-01-01',
        programId: 'p-1',
        location: 'Athens',
        status: 'completed',
        exercises: [
          {
            exerciseId: 'ex-1',
            sets: [
              { reps: 8, weight: 40 },
              { reps: 8, weight: 40 },
              { reps: 8, weight: 40 },
              { reps: 8, weight: 40 }
            ]
          }
        ]
      },
      catalog,
      now
    )

    expect(upgraded.exercises[0]).toMatchObject({
      exerciseId: 'ex-1',
      name: 'Bench press',
      muscle: 'chest',
      targetSets: 4,
      targetReps: 8,
      isRehab: false
    })
    expect(upgraded.status).toBe('completed')
    expect(upgraded.updatedAt).toBe(now)
  })

  it('uses a placeholder snapshot when the catalog exercise is gone', () => {
    const upgraded = upgradeWorkoutSessionRecord(
      {
        id: 's-2',
        date: '2026-01-01',
        programId: 'p-1',
        location: '',
        status: 'incomplete',
        exercises: [{ exerciseId: 'missing', sets: [{ reps: 8, weight: 10 }] }]
      },
      new Map(),
      now
    )

    expect(upgraded.exercises[0]).toMatchObject({
      exerciseId: 'missing',
      name: '(deleted)',
      muscle: 'core',
      targetSets: 1
    })
  })
})
