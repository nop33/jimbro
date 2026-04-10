import { describe, it, expect } from 'vite-plus/test'
import { computeWorkoutSessionStatus } from '../src/state/GymtimeSessionState'

describe('computeWorkoutSessionStatus', () => {
  const defs = new Map<string, { sets: number }>([
    ['ex1', { sets: 3 }],
    ['ex2', { sets: 4 }],
    ['ex3', { sets: 2 }]
  ])
  const getDef = (id: string) => defs.get(id)
  const setExecution = { reps: 10, weight: 100 }
  const fullSets = (n: number) => Array.from({ length: n }, () => setExecution)

  it('returns incomplete for an empty exercise list', () => {
    expect(computeWorkoutSessionStatus({ exercises: [] }, getDef)).toBe('incomplete')
  })

  it('returns completed when every exercise has at least its target number of sets', () => {
    const session = {
      exercises: [
        { exerciseId: 'ex1', sets: fullSets(3) },
        { exerciseId: 'ex2', sets: fullSets(4) },
        { exerciseId: 'ex3', sets: fullSets(2) }
      ]
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('completed')
  })

  it('returns incomplete when any middle exercise has fewer sets than its target', () => {
    const session = {
      exercises: [
        { exerciseId: 'ex1', sets: fullSets(3) },
        { exerciseId: 'ex2', sets: fullSets(2) }, // 2 of 4
        { exerciseId: 'ex3', sets: fullSets(2) }
      ]
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('incomplete')
  })

  it('returns incomplete when only the last exercise is a blocker', () => {
    const session = {
      exercises: [
        { exerciseId: 'ex1', sets: fullSets(3) },
        { exerciseId: 'ex2', sets: fullSets(4) },
        { exerciseId: 'ex3', sets: fullSets(1) } // 1 of 2
      ]
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('incomplete')
  })

  it('returns completed when an exercise has more sets than its target', () => {
    const session = {
      exercises: [{ exerciseId: 'ex1', sets: fullSets(5) }] // 5 of 3
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('completed')
  })

  it('returns incomplete when an exercise has zero sets logged', () => {
    const session = {
      exercises: [{ exerciseId: 'ex1', sets: [] }]
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('incomplete')
  })

  it('returns incomplete when an exercise references an unknown definition', () => {
    const session = {
      exercises: [
        { exerciseId: 'ex1', sets: fullSets(3) },
        { exerciseId: 'deleted-exercise', sets: fullSets(10) }
      ]
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('incomplete')
  })

  it('does not treat an exercise with exactly target sets as over or under', () => {
    const session = {
      exercises: [{ exerciseId: 'ex2', sets: fullSets(4) }] // exactly 4 of 4
    }
    expect(computeWorkoutSessionStatus(session, getDef)).toBe('completed')
  })
})
