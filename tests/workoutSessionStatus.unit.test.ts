import { describe, it, expect } from 'vite-plus/test'
import { computeWorkoutSessionStatus } from '../src/state/GymtimeSessionState'
import type { ExerciseExecution } from '../src/db/stores/workoutSessionsStore'

describe('computeWorkoutSessionStatus', () => {
  const setExecution = { reps: 10, weight: 100 }
  const fullSets = (n: number) => Array.from({ length: n }, () => setExecution)
  const execution = (exerciseId: string, targetSets: number, logged: number): ExerciseExecution => ({
    exerciseId,
    name: exerciseId,
    muscle: 'chest',
    targetSets,
    targetReps: 8,
    isRehab: false,
    sets: fullSets(logged)
  })

  it('returns incomplete for an empty exercise list', () => {
    expect(computeWorkoutSessionStatus({ exercises: [] })).toBe('incomplete')
  })

  it('returns completed when every exercise has at least its snapshotted target sets', () => {
    const session = {
      exercises: [execution('ex1', 3, 3), execution('ex2', 4, 4), execution('ex3', 2, 2)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('completed')
  })

  it('returns incomplete when any middle exercise has fewer sets than its target', () => {
    const session = {
      exercises: [execution('ex1', 3, 3), execution('ex2', 4, 2), execution('ex3', 2, 2)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('incomplete')
  })

  it('returns incomplete when only the last exercise is a blocker', () => {
    const session = {
      exercises: [execution('ex1', 3, 3), execution('ex2', 4, 4), execution('ex3', 2, 1)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('incomplete')
  })

  it('returns completed when an exercise has more sets than its target', () => {
    const session = {
      exercises: [execution('ex1', 3, 5)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('completed')
  })

  it('returns incomplete when an exercise has zero sets logged', () => {
    const session = {
      exercises: [execution('ex1', 3, 0)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('incomplete')
  })

  it('uses the snapshot target even if the catalog exercise is gone', () => {
    const session = {
      exercises: [execution('ex1', 3, 3), execution('deleted-exercise', 4, 4)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('completed')
  })

  it('does not treat an exercise with exactly target sets as over or under', () => {
    const session = {
      exercises: [execution('ex2', 4, 4)]
    }
    expect(computeWorkoutSessionStatus(session)).toBe('completed')
  })
})
