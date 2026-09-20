import { describe, expect, it } from 'vite-plus/test'
import {
  breakTimerEnabled,
  defaultLabel,
  defaultPresetForKind,
  historyChartEnabled,
  defaultSlotsForPreset,
  inputLabel,
  slotsForPreset,
  emptySet,
  formatPrescription,
  fromDisplayValues,
  muscleRequired,
  parseSet,
  presetsForKind,
  setFields,
  toDisplayValues
} from '../src/db/exerciseLogging'
import { upgradeExerciseRecord, upgradeWorkoutSessionRecord } from '../src/db/schemaUpgrade'

const now = '2026-09-20T12:00:00.000Z'

describe('log preset registry', () => {
  it('offers one preset for lifting and cardio and two for rehab', () => {
    expect(presetsForKind('lifting')).toEqual(['lifting'])
    expect(presetsForKind('rehab')).toEqual(['rehabReps', 'rehabHold'])
    expect(presetsForKind('cardio')).toEqual(['cardioTreadmill'])
  })

  it('defaults rehab to reps logging', () => {
    expect(defaultPresetForKind('lifting')).toBe('lifting')
    expect(defaultPresetForKind('rehab')).toBe('rehabReps')
    expect(defaultPresetForKind('cardio')).toBe('cardioTreadmill')
  })

  it('runs the break timer for lifting and cardio but not rehab', () => {
    expect(breakTimerEnabled('lifting')).toBe(true)
    expect(breakTimerEnabled('rehabReps')).toBe(false)
    expect(breakTimerEnabled('rehabHold')).toBe(false)
    expect(breakTimerEnabled('cardioTreadmill')).toBe(true)
  })

  it('hides the gymtime history chart for cardio', () => {
    expect(historyChartEnabled('lifting')).toBe(true)
    expect(historyChartEnabled('rehab')).toBe(true)
    expect(historyChartEnabled('cardio')).toBe(false)
  })

  it('requires a muscle group for everything except cardio', () => {
    expect(muscleRequired('lifting')).toBe(true)
    expect(muscleRequired('rehabReps')).toBe(true)
    expect(muscleRequired('rehabHold')).toBe(true)
    expect(muscleRequired('cardioTreadmill')).toBe(false)
  })

  it('formats a prescription per preset', () => {
    expect(formatPrescription({ preset: 'lifting', targetSets: 3, defaults: { reps: 10 } })).toBe('3 sets × 10 reps')
    expect(formatPrescription({ preset: 'rehabReps', targetSets: 3, defaults: { reps: 10 } })).toBe('3 sets × 10 reps')
    expect(formatPrescription({ preset: 'rehabHold', targetSets: 3, defaults: { durationSec: 30 } })).toBe(
      '3 sets × 30s hold'
    )
    expect(formatPrescription({ preset: 'cardioTreadmill', targetSets: 1, defaults: {} })).toBe('1 set')
    expect(formatPrescription({ preset: 'cardioTreadmill', targetSets: 8, defaults: {} })).toBe('8 sets')
  })

  it('does not collect cardio slot defaults on the exercise', () => {
    expect(defaultSlotsForPreset('cardioTreadmill')).toEqual([])
    expect(defaultSlotsForPreset('lifting').map((slot) => slot.slot)).toEqual(['reps'])
  })

  it('builds input and default labels from the slot unit', () => {
    const [reps, weight] = slotsForPreset('lifting')
    const [hold] = slotsForPreset('rehabHold')
    const [time, speed, incline] = slotsForPreset('cardioTreadmill')

    expect(inputLabel(reps)).toBe('Reps')
    expect(defaultLabel(reps)).toBe('Default reps')
    expect(inputLabel(weight)).toBe('Weight (kg)')
    expect(defaultLabel(weight)).toBe('Default weight (kg)')
    expect(inputLabel(hold)).toBe('Hold (sec)')
    expect(defaultLabel(hold)).toBe('Default hold (sec)')
    expect(inputLabel(time)).toBe('Time (min)')
    expect(defaultLabel(time)).toBe('Default time (min)')
    expect(inputLabel(speed)).toBe('Speed (km/h)')
    expect(defaultLabel(speed)).toBe('Default speed (km/h)')
    expect(inputLabel(incline)).toBe('Incline (%)')
    expect(defaultLabel(incline)).toBe('Default incline (%)')
  })

  it('builds a zeroed set for each preset', () => {
    expect(emptySet('lifting')).toEqual({ preset: 'lifting', reps: 0, weight: 0 })
    expect(emptySet('rehabHold')).toEqual({ preset: 'rehabHold', durationSec: 0, weight: undefined })
    expect(emptySet('cardioTreadmill')).toEqual({
      preset: 'cardioTreadmill',
      durationSec: 0,
      speed: 0,
      incline: 0
    })
  })

  it('converts treadmill minutes to stored seconds and back', () => {
    expect(fromDisplayValues('cardioTreadmill', { durationSec: '20', speed: '5.5', incline: '0' })).toEqual({
      durationSec: 1200,
      speed: 5.5,
      incline: 0
    })
    expect(toDisplayValues('cardioTreadmill', { durationSec: 1200, speed: 5.5, incline: 0 })).toEqual({
      durationSec: 20,
      speed: 5.5,
      incline: 0
    })
  })

  it('keeps hold seconds unscaled', () => {
    expect(fromDisplayValues('rehabHold', { durationSec: '30', weight: '2.5' })).toEqual({
      durationSec: 30,
      weight: 2.5
    })
  })

  it('labels the displayed fields of a set', () => {
    expect(setFields({ preset: 'lifting', reps: 10, weight: 40 })).toEqual([
      { slot: 'reps', label: 'Reps', text: '10' },
      { slot: 'weight', label: 'Weight', text: '40', unit: 'kg' }
    ])
    expect(setFields({ preset: 'cardioTreadmill', durationSec: 1200, speed: 5.5, incline: 0 })).toEqual([
      { slot: 'durationSec', label: 'Time', text: '20', unit: 'min' },
      { slot: 'speed', label: 'Speed', text: '5.5', unit: 'km/h' },
      { slot: 'incline', label: 'Incline', text: '0', unit: '%' }
    ])
    expect(setFields({ preset: 'lifting', reps: 0, weight: 0 })).toEqual([
      { slot: 'reps', label: 'Reps', text: '-' },
      { slot: 'weight', label: 'Weight', text: '-' }
    ])
  })

  it('tags an untagged set with the execution preset and passes a tagged set through', () => {
    expect(parseSet({ reps: 8, weight: 40 }, 'lifting')).toEqual({ preset: 'lifting', reps: 8, weight: 40 })
    expect(parseSet({ reps: 12, weight: 3 }, 'rehabReps')).toEqual({ preset: 'rehabReps', reps: 12, weight: 3 })
    expect(parseSet({ preset: 'rehabHold', durationSec: 45 }, 'lifting')).toEqual({
      preset: 'rehabHold',
      durationSec: 45,
      weight: undefined
    })
  })
})

describe('parsing a v3 export', () => {
  it('turns a rehab exercise into kind rehab with the rehabReps preset', () => {
    expect(
      upgradeExerciseRecord(
        {
          id: '4c3cd565-c78e-4708-8d81-0b2bb61ebf8b',
          name: 'Rubber band rows',
          muscle: 'shoulders',
          targetSets: 3,
          targetReps: 10,
          isDeleted: false,
          isRehab: true,
          updatedAt: '2026-08-31T08:40:30.052Z'
        },
        now
      )
    ).toEqual({
      id: '4c3cd565-c78e-4708-8d81-0b2bb61ebf8b',
      name: 'Rubber band rows',
      kind: 'rehab',
      preset: 'rehabReps',
      muscle: 'shoulders',
      targetSets: 3,
      defaults: { reps: 10 },
      isDeleted: false,
      updatedAt: '2026-08-31T08:40:30.052Z'
    })
  })

  it('turns a non-rehab exercise into kind lifting and keeps the muscle slug', () => {
    expect(
      upgradeExerciseRecord(
        {
          id: '08e802c1-1870-4b8d-bc02-5c72159e4f74',
          name: 'Rope pushdowns',
          muscle: 'triceps',
          targetSets: 4,
          targetReps: 8,
          isDeleted: false,
          isRehab: false,
          updatedAt: '2026-08-31T08:40:30.052Z'
        },
        now
      )
    ).toEqual({
      id: '08e802c1-1870-4b8d-bc02-5c72159e4f74',
      name: 'Rope pushdowns',
      kind: 'lifting',
      preset: 'lifting',
      muscle: 'triceps',
      targetSets: 4,
      defaults: { reps: 8 },
      isDeleted: false,
      updatedAt: '2026-08-31T08:40:30.052Z'
    })
  })

  it('tags the sets of a snapshotted session exercise with its preset', () => {
    const upgraded = upgradeWorkoutSessionRecord(
      {
        id: 'fb9848d8-9cf8-489a-b8aa-1ea6ae0ad68b',
        date: '2026-05-05',
        programId: '07c50b23-d3ad-4c30-a4a9-d8bdf58a2300',
        location: 'Zurich',
        status: 'completed',
        notes: '',
        updatedAt: '2026-08-31T08:40:30.052Z',
        exercises: [
          {
            exerciseId: '46dfb9e1-d206-43e7-9825-07060f478989',
            name: 'Side delt cable fly',
            muscle: 'shoulders',
            targetSets: 4,
            targetReps: 8,
            isRehab: false,
            sets: [
              { reps: 12, weight: 11.3 },
              { reps: 15, weight: 11.3 }
            ]
          }
        ]
      },
      new Map(),
      now
    )

    expect(upgraded.exercises[0]).toEqual({
      exerciseId: '46dfb9e1-d206-43e7-9825-07060f478989',
      name: 'Side delt cable fly',
      kind: 'lifting',
      preset: 'lifting',
      muscle: 'shoulders',
      targetSets: 4,
      defaults: { reps: 8 },
      sets: [
        { preset: 'lifting', reps: 12, weight: 11.3 },
        { preset: 'lifting', reps: 15, weight: 11.3 }
      ]
    })
  })
})

describe('parsing a v4 export', () => {
  it('keeps an explicit kind and preset and drops the muscle for cardio', () => {
    expect(
      upgradeExerciseRecord(
        {
          id: 'treadmill-1',
          name: 'Treadmill walk',
          kind: 'cardio',
          preset: 'cardioTreadmill',
          targetSets: 1,
          defaults: { durationSec: 1200, speed: 5.5, incline: 0 },
          isDeleted: false,
          updatedAt: '2026-09-19T08:00:00.000Z'
        },
        now
      )
    ).toEqual({
      id: 'treadmill-1',
      name: 'Treadmill walk',
      kind: 'cardio',
      preset: 'cardioTreadmill',
      muscle: undefined,
      targetSets: 1,
      defaults: { durationSec: 1200, speed: 5.5, incline: 0 },
      isDeleted: false,
      updatedAt: '2026-09-19T08:00:00.000Z'
    })
  })

  it('keeps a rehab hold exercise on its preset without inventing a reps default', () => {
    expect(
      upgradeExerciseRecord(
        {
          id: 'plank-1',
          name: 'Side plank',
          kind: 'rehab',
          preset: 'rehabHold',
          muscle: 'core',
          targetSets: 3,
          defaults: { durationSec: 30 },
          isDeleted: false,
          updatedAt: '2026-09-19T08:00:00.000Z'
        },
        now
      )
    ).toEqual({
      id: 'plank-1',
      name: 'Side plank',
      kind: 'rehab',
      preset: 'rehabHold',
      muscle: 'core',
      targetSets: 3,
      defaults: { durationSec: 30 },
      isDeleted: false,
      updatedAt: '2026-09-19T08:00:00.000Z'
    })
  })
})
