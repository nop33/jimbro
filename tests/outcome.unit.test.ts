import { describe, expect, it } from 'vite-plus/test'
import { emptySet, type LogPreset } from '../src/db/exerciseLogging'
import { computeWorkoutSessionStatus } from '../src/db/stores/workoutSessionsStore'
import type { ExerciseExecution, WorkoutSession } from '../src/db/types'
import { outcomeOf } from '../src/pages/gymtime/outcome'

const BREAK = 150

// An exercise with targetSets to do and logged sets in, of the given preset.
const exercise = (
  exerciseId: string,
  targetSets: number,
  logged: number,
  preset: LogPreset = 'lifting'
): ExerciseExecution => ({
  exerciseId,
  name: `${exerciseId} name`,
  kind: preset === 'lifting' ? 'lifting' : preset === 'cardioTreadmill' ? 'cardio' : 'rehab',
  preset,
  targetSets,
  defaults: {},
  sets: Array.from({ length: logged }, () => emptySet(preset))
})

// A session holding the exercises, with the status the store would compute for them.
const session = (...exercises: Array<ExerciseExecution>): WorkoutSession => ({
  id: 'session',
  date: '2026-10-11',
  programId: 'program',
  location: '',
  status: computeWorkoutSessionStatus({ exercises }),
  exercises,
  updatedAt: '2026-10-11T10:00:00.000Z'
})

describe('outcomeOf', () => {
  describe('a set logged from a card', () => {
    it('starts a break with the sets done, the sets to do and the next unfinished exercise', () => {
      const before = session(exercise('bench', 3, 0), exercise('row', 3, 0))
      const after = session(exercise('bench', 3, 1), exercise('row', 3, 0))

      expect(outcomeOf(before, after, 'bench', BREAK)).toEqual({
        kind: 'rest',
        seconds: BREAK,
        setsDone: 1,
        setsTotal: 3,
        next: 'row name',
        exercise: { id: 'bench', name: 'bench name', kind: 'lifting' }
      })
    })

    it('rests for the break length it is given', () => {
      const before = session(exercise('bench', 3, 0))
      const after = session(exercise('bench', 3, 1))

      expect(outcomeOf(before, after, 'bench', 75)).toMatchObject({ kind: 'rest', seconds: 75 })
    })

    it('names no next exercise when every other one is done', () => {
      const before = session(exercise('bench', 3, 1), exercise('row', 2, 2))
      const after = session(exercise('bench', 3, 2), exercise('row', 2, 2))

      expect(outcomeOf(before, after, 'bench', BREAK)).toMatchObject({ kind: 'rest', next: undefined })
    })

    it('skips finished exercises and wraps round to find the next one', () => {
      const before = session(exercise('squat', 2, 0), exercise('bench', 3, 0), exercise('row', 2, 2))
      const after = session(exercise('squat', 2, 0), exercise('bench', 3, 1), exercise('row', 2, 2))

      expect(outcomeOf(before, after, 'bench', BREAK)).toMatchObject({ kind: 'rest', next: 'squat name' })
    })

    it('starts a break for a treadmill set, whose preset has one', () => {
      const before = session(exercise('run', 2, 0, 'cardioTreadmill'))
      const after = session(exercise('run', 2, 1, 'cardioTreadmill'))

      expect(outcomeOf(before, after, 'run', BREAK)).toMatchObject({
        kind: 'rest',
        exercise: { id: 'run', name: 'run name', kind: 'cardio' }
      })
    })

    it('means nothing for a rehab set, whose presets have no break', () => {
      for (const preset of ['rehabReps', 'rehabHold'] as const) {
        const before = session(exercise('plank', 3, 0, preset))
        const after = session(exercise('plank', 3, 1, preset))

        expect(outcomeOf(before, after, 'plank', BREAK)).toEqual({ kind: 'none' })
      }
    })

    it('finishes the exercise with its last set, with no break', () => {
      const before = session(exercise('bench', 3, 2), exercise('row', 3, 0))
      const after = session(exercise('bench', 3, 3), exercise('row', 3, 0))

      expect(outcomeOf(before, after, 'bench', BREAK)).toEqual({ kind: 'exercise-done', exerciseId: 'bench' })
    })

    it('finishes a rehab exercise too, though it has no break', () => {
      const before = session(exercise('plank', 2, 1, 'rehabHold'), exercise('row', 3, 0))
      const after = session(exercise('plank', 2, 2, 'rehabHold'), exercise('row', 3, 0))

      expect(outcomeOf(before, after, 'plank', BREAK)).toEqual({ kind: 'exercise-done', exerciseId: 'plank' })
    })

    it('finishes the workout, not just the exercise, with the last set of the last exercise', () => {
      const before = session(exercise('bench', 3, 3), exercise('row', 2, 1))
      const after = session(exercise('bench', 3, 3), exercise('row', 2, 2))

      expect(outcomeOf(before, after, 'row', BREAK)).toEqual({ kind: 'workout-done' })
    })

    it('means nothing when the write logged no set for the exercise', () => {
      const before = session(exercise('bench', 3, 1))

      expect(outcomeOf(before, before, 'bench', BREAK)).toEqual({ kind: 'none' })
    })

    it('means nothing when the exercise is not in the session', () => {
      const before = session(exercise('bench', 3, 1))
      const after = session(exercise('bench', 3, 2))

      expect(outcomeOf(before, after, 'row', BREAK)).toEqual({ kind: 'none' })
    })
  })

  describe('any other change', () => {
    it('finishes the workout when it takes the session from incomplete to completed', () => {
      // Deleting the last unfinished exercise.
      const before = session(exercise('bench', 3, 3), exercise('row', 3, 0))
      const after = session(exercise('bench', 3, 3))

      expect(outcomeOf(before, after, undefined, BREAK)).toEqual({ kind: 'workout-done' })
    })

    it('finishes the workout again after Add set made it incomplete', () => {
      const completed = session(exercise('bench', 2, 2))
      const extraSlot = session(exercise('bench', 3, 2))
      const loggedExtra = session(exercise('bench', 3, 3))

      expect(outcomeOf(completed, extraSlot, undefined, BREAK)).toEqual({ kind: 'none' })
      expect(outcomeOf(extraSlot, loggedExtra, 'bench', BREAK)).toEqual({ kind: 'workout-done' })
    })

    it('means nothing for a change to a workout that was already completed', () => {
      // Editing a logged set, or moving an exercise, in a finished workout.
      const completed = session(exercise('bench', 2, 2), exercise('row', 1, 1))
      const moved = session(exercise('row', 1, 1), exercise('bench', 2, 2))

      expect(outcomeOf(completed, moved, undefined, BREAK)).toEqual({ kind: 'none' })
      expect(outcomeOf(completed, completed, undefined, BREAK)).toEqual({ kind: 'none' })
    })

    it('means nothing for a change that leaves the workout incomplete', () => {
      const before = session(exercise('bench', 3, 1), exercise('row', 3, 0))
      const moved = session(exercise('row', 3, 0), exercise('bench', 3, 1))
      const added = session(exercise('bench', 3, 1), exercise('row', 3, 0), exercise('squat', 3, 0))

      expect(outcomeOf(before, moved, undefined, BREAK)).toEqual({ kind: 'none' })
      expect(outcomeOf(before, added, undefined, BREAK)).toEqual({ kind: 'none' })
    })

    it('neither finishes an exercise nor starts a break without a set logged from a card', () => {
      // A set the edit dialog changes or a write outside the card's form.
      const before = session(exercise('bench', 3, 2), exercise('row', 3, 0))
      const after = session(exercise('bench', 3, 3), exercise('row', 3, 0))

      expect(outcomeOf(before, after, undefined, BREAK)).toEqual({ kind: 'none' })
    })
  })
})
