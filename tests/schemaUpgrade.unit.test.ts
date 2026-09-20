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
      kind: 'lifting',
      preset: 'lifting',
      muscle: 'chest',
      targetSets: 4,
      defaults: { reps: 8 },
      isDeleted: false,
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
          kind: 'lifting',
          preset: 'lifting',
          muscle: 'chest',
          targetSets: 5,
          defaults: { reps: 8 },
          isDeleted: false,
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

    expect(upgraded.exercises[0]).toEqual({
      exerciseId: 'ex-1',
      name: 'Bench press',
      kind: 'lifting',
      preset: 'lifting',
      muscle: 'chest',
      targetSets: 4,
      defaults: { reps: 8 },
      sets: [
        { preset: 'lifting', reps: 8, weight: 40 },
        { preset: 'lifting', reps: 8, weight: 40 },
        { preset: 'lifting', reps: 8, weight: 40 },
        { preset: 'lifting', reps: 8, weight: 40 }
      ]
    })
    expect(upgraded.status).toBe('completed')
    expect(upgraded.updatedAt).toBe(now)
  })

  it('carries the catalog preset onto the sets of an unsnapshotted rehab exercise', () => {
    const catalog = new Map<string, Exercise>([
      [
        'ex-hold',
        {
          id: 'ex-hold',
          name: 'Side plank',
          kind: 'rehab',
          preset: 'rehabHold',
          muscle: 'core',
          targetSets: 3,
          defaults: { durationSec: 30 },
          isDeleted: false,
          updatedAt: now
        }
      ]
    ])

    const upgraded = upgradeWorkoutSessionRecord(
      {
        id: 's-3',
        date: '2026-01-02',
        programId: 'p-1',
        location: '',
        status: 'incomplete',
        exercises: [{ exerciseId: 'ex-hold', sets: [{ durationSec: 45 }] }]
      },
      catalog,
      now
    )

    expect(upgraded.exercises[0]).toEqual({
      exerciseId: 'ex-hold',
      name: 'Side plank',
      kind: 'rehab',
      preset: 'rehabHold',
      muscle: 'core',
      targetSets: 3,
      defaults: { durationSec: 30 },
      sets: [{ preset: 'rehabHold', durationSec: 45, weight: undefined }]
    })
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

    expect(upgraded.exercises[0]).toEqual({
      exerciseId: 'missing',
      name: '(deleted)',
      kind: 'lifting',
      preset: 'lifting',
      muscle: 'core',
      targetSets: 1,
      defaults: {},
      sets: [{ preset: 'lifting', reps: 8, weight: 10 }]
    })
  })
})
