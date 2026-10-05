import { describe, expect, it } from 'vitest'
import {
  EXERCISE_KINDS,
  LOG_PRESET_SPECS,
  buildSet,
  slotsForPreset,
  type LogPreset
} from '../../src/db/exerciseLogging'
import { MUSCLE_GROUPS } from '../../src/db/muscleGroups'
import { SESSION_STATUSES } from '../../src/db/types'
import { parsePushBody } from '../src/rows'

const updatedAt = '2026-01-02T00:00:00.000Z'

const presets = Object.keys(LOG_PRESET_SPECS) as Array<LogPreset>

const exerciseRow = (fields: Record<string, unknown> = {}) => ({
  table: 'exercises',
  row: {
    id: 'exercise-1',
    name: 'Bench press',
    kind: 'lifting',
    preset: 'lifting',
    muscle: 'chest',
    targetSets: 3,
    defaults: { reps: 5 },
    isDeleted: false,
    updatedAt,
    ...fields
  }
})

const sessionRow = (fields: Record<string, unknown> = {}) => ({
  table: 'sessions',
  row: {
    id: 'session-1',
    date: '2026-01-02',
    programId: 'program-1',
    location: 'Zurich',
    status: 'completed',
    exercises: [],
    isDeleted: false,
    updatedAt,
    ...fields
  }
})

const setRow = (set: unknown) => ({
  table: 'sets',
  row: {
    id: 'session-1:exercise-1:0',
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    position: 0,
    set,
    isDeleted: false,
    updatedAt
  }
})

const filledSet = (preset: LogPreset): Record<string, unknown> => ({
  ...buildSet(preset, Object.fromEntries(slotsForPreset(preset).map(({ slot }) => [slot, 1])))
})

const accepts = (row: unknown) => parsePushBody({ rows: [row] }).ok

describe('push validation follows the exercise logging registry', () => {
  it.each(presets)('accepts a %s set with every slot filled', (preset) => {
    expect(accepts(setRow(filledSet(preset)))).toBe(true)
  })

  it.each(presets)('rejects a %s set without a required slot', (preset) => {
    for (const { slot } of slotsForPreset(preset).filter(({ required }) => required)) {
      const set = filledSet(preset)
      delete set[slot]
      expect(accepts(setRow(set)), slot).toBe(false)
    }
  })

  it.each(presets)('accepts a %s set without an optional slot, and rejects text in it', (preset) => {
    for (const { slot } of slotsForPreset(preset).filter(({ required }) => !required)) {
      const set = filledSet(preset)
      delete set[slot]
      expect(accepts(setRow(set)), slot).toBe(true)
      expect(accepts(setRow({ ...set, [slot]: 'heavy' })), slot).toBe(false)
    }
  })

  it('accepts every kind, preset and muscle group the registry lists', () => {
    for (const kind of EXERCISE_KINDS) expect(accepts(exerciseRow({ kind })), kind).toBe(true)
    for (const preset of presets) expect(accepts(exerciseRow({ preset })), preset).toBe(true)
    for (const muscle of MUSCLE_GROUPS) expect(accepts(exerciseRow({ muscle })), muscle).toBe(true)
    for (const status of SESSION_STATUSES) expect(accepts(sessionRow({ status })), status).toBe(true)
  })

  it('rejects a kind, preset, muscle group or status the registry does not list', () => {
    expect(accepts(exerciseRow({ kind: 'swimming' }))).toBe(false)
    expect(accepts(exerciseRow({ preset: 'swimming' }))).toBe(false)
    expect(accepts(exerciseRow({ muscle: 'neck' }))).toBe(false)
    expect(accepts(sessionRow({ status: 'pending' }))).toBe(false)
    expect(accepts(setRow({ ...filledSet('lifting'), preset: 'swimming' }))).toBe(false)
  })
})
