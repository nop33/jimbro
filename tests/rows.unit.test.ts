import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { upgradeExerciseRecord, upgradeProgramRecord, upgradeWorkoutSessionRecord } from '../src/db/schemaUpgrade'
import type { Exercise } from '../src/db/stores/exercisesStore'
import type { WorkoutSession } from '../src/db/stores/workoutSessionsStore'
import {
  exportFromRows,
  legacySetId,
  rowsEqual,
  rowsFromExport,
  rowsFromSession,
  sessionFromRows,
  type SessionHeader,
  type SetRow
} from '../src/sync/rows'

const NOW = '2026-01-02T10:24:41.458Z'

const countSets = (sessions: Array<{ exercises: Array<{ sets?: Array<unknown> }> }>): number =>
  sessions.reduce(
    (total, session) => total + session.exercises.reduce((sum, exercise) => sum + (exercise.sets?.length ?? 0), 0),
    0
  )

describe('row shapes', () => {
  it('builds a legacy set id from the session, exercise, and position', () => {
    expect(legacySetId('sess-1', 'ex-9', 2)).toBe('sess-1:ex-9:2')
  })

  it('treats rows as equal when only key order differs', () => {
    const left = {
      id: 'set-1',
      sessionId: 'sess-1',
      exerciseId: 'ex-1',
      position: 0,
      set: { preset: 'lifting' as const, reps: 8, weight: 40 },
      isDeleted: false,
      updatedAt: NOW
    }
    const right = {
      updatedAt: NOW,
      isDeleted: false,
      set: { weight: 40, reps: 8, preset: 'lifting' as const },
      position: 0,
      exerciseId: 'ex-1',
      sessionId: 'sess-1',
      id: 'set-1'
    }

    expect(rowsEqual(left, right)).toBe(true)
    expect(rowsEqual(left, { ...right, position: 1 })).toBe(false)
  })

  it('drops a tombstoned set when assembling a session', () => {
    const header: SessionHeader = {
      id: 'sess-1',
      date: '2026-01-02',
      programId: 'prog-1',
      location: 'Zurich',
      status: 'completed',
      exercises: [
        {
          exerciseId: 'ex-1',
          name: 'Bench press',
          kind: 'lifting',
          preset: 'lifting',
          muscle: 'chest',
          targetSets: 2,
          defaults: { reps: 8 }
        }
      ],
      isDeleted: false,
      updatedAt: NOW
    }
    const sets: Array<SetRow> = [
      {
        id: 'sess-1:ex-1:0',
        sessionId: 'sess-1',
        exerciseId: 'ex-1',
        position: 1,
        set: { preset: 'lifting', reps: 5, weight: 10 },
        isDeleted: true,
        updatedAt: NOW
      },
      {
        id: 'sess-1:ex-1:1',
        sessionId: 'sess-1',
        exerciseId: 'ex-1',
        position: 0,
        set: { preset: 'lifting', reps: 8, weight: 40 },
        isDeleted: false,
        updatedAt: NOW
      }
    ]

    expect(sessionFromRows(header, sets).exercises[0].sets).toEqual([{ preset: 'lifting', reps: 8, weight: 40 }])
  })

  it('reads a stored session back equal to the one the page holds', () => {
    const session: WorkoutSession = {
      id: 'sess-1',
      date: '2026-01-02',
      programId: 'prog-1',
      location: 'Zurich',
      status: 'incomplete',
      notes: '',
      exercises: [
        {
          exerciseId: 'ex-plank',
          name: 'Side plank',
          kind: 'rehab',
          preset: 'rehabHold',
          muscle: 'core',
          targetSets: 3,
          defaults: { durationSec: 30 },
          sets: [{ preset: 'rehabHold', durationSec: 30, weight: undefined }]
        },
        {
          exerciseId: 'ex-walk',
          name: 'Treadmill walk',
          kind: 'cardio',
          preset: 'cardioTreadmill',
          muscle: undefined,
          targetSets: 1,
          defaults: {},
          sets: []
        }
      ],
      updatedAt: NOW
    }
    // Storage clones rows through JSON before IndexedDB keeps them, which drops the undefined fields.
    const stored = JSON.parse(JSON.stringify(rowsFromSession(session))) as ReturnType<typeof rowsFromSession>

    expect(rowsEqual(sessionFromRows(stored.header, stored.sets), session)).toBe(true)
    stored.sets[0].set = { preset: 'rehabHold', durationSec: 45 }
    expect(rowsEqual(sessionFromRows(stored.header, stored.sets), session)).toBe(false)
  })

  it('round-trips the upgraded January export', () => {
    const raw = JSON.parse(readFileSync('data-backup/gymbro-export-2026-01-02.json', 'utf8')) as {
      version: number
      exportDate: string
      stores: {
        exercises: Array<Record<string, unknown>>
        programs: Array<Record<string, unknown>>
        workoutSessions: Array<Record<string, unknown>>
      }
    }
    const exercises = raw.stores.exercises.map((exercise) => upgradeExerciseRecord(exercise, NOW))
    const programs = raw.stores.programs.map((program) => upgradeProgramRecord(program, NOW))
    const catalog = new Map<string, Exercise>(exercises.map((exercise) => [exercise.id, exercise]))
    const workoutSessions = raw.stores.workoutSessions.map((session, index) =>
      upgradeWorkoutSessionRecord({ ...session, id: `jan-session-${index}` }, catalog, NOW)
    )
    const upgraded = {
      version: 4,
      exportDate: raw.exportDate,
      stores: { exercises, programs, workoutSessions }
    }

    expect(raw.version).toBe(1)
    expect(upgraded.stores.workoutSessions).toHaveLength(106)
    expect(countSets(upgraded.stores.workoutSessions)).toBe(2581)

    const rows = rowsFromExport(upgraded)
    expect(rows.sets).toHaveLength(2581)
    expect(rows.sets[0].id).toBe(legacySetId(rows.sets[0].sessionId, rows.sets[0].exerciseId, rows.sets[0].position))
    expect(exportFromRows(rows)).toEqual(upgraded)

    const first = rowsFromSession(workoutSessions[0])
    expect(first.sets[0].id).toBe(legacySetId(workoutSessions[0].id, workoutSessions[0].exercises[0].exerciseId, 0))
    expect(first.sets[0].updatedAt).toBe(workoutSessions[0].updatedAt)
    expect(first.header.exercises[0]).not.toHaveProperty('sets')
  })
})
