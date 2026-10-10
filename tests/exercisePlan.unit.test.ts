import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { Exercise } from '../src/db/stores/exercisesStore'
import { snapshotFromExercise, workoutSessionsStore } from '../src/db/stores/workoutSessionsStore'
import { planExercise } from '../src/pages/gymtime/exercisePlan'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

// Each test uses its own exercise, since the tests share one database.
const exercise = (id: string, targetSets = 3): Exercise => ({
  id,
  name: id,
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'chest',
  targetSets,
  defaults: { reps: 5 },
  isDeleted: false,
  updatedAt: '2026-10-01T00:00:00.000Z'
})

const lift = (weight: number) => ({ preset: 'lifting' as const, reps: 5, weight })

const workout = async (lifted: Exercise, date: string, location: string, weights: Array<number>) => {
  let session = await workoutSessionsStore.create({
    date,
    programId: 'program',
    location,
    exercises: [snapshotFromExercise(lifted)]
  })
  for (const weight of weights) session = await workoutSessionsStore.addSet(session, lifted.id, lift(weight))
  return session
}

describe('planExercise', () => {
  it('takes last time from an earlier workout, never from the open one', async () => {
    const bench = exercise('bench')
    await workout(bench, '2026-10-01', 'Zurich', [40, 45, 50, 50, 50])
    const today = await workout(bench, '2026-10-08', 'Zurich', [55])

    const plan = await planExercise(snapshotFromExercise(bench), today)

    expect(plan.lastTime).toMatchObject({
      date: '2026-10-01',
      sets: [lift(40), lift(45), lift(50), lift(50), lift(50)]
    })
    expect(plan.targetSets).toBe(5)
    expect(plan.prefill).toEqual({ reps: 5, weight: 55 })
  })

  it('prefers last time at the same gym, and falls back to any gym', async () => {
    const row = exercise('row')
    await workout(row, '2026-10-01', 'Zurich', [30, 30, 30, 30])
    await workout(row, '2026-10-05', 'Athens', [20])

    const inZurich = await workout(row, '2026-10-08', 'Zurich', [])
    expect((await planExercise(snapshotFromExercise(row), inZurich)).lastTime?.location).toBe('Zurich')

    const inBerlin = await workout(row, '2026-10-09', 'Berlin', [])
    expect((await planExercise(snapshotFromExercise(row), inBerlin)).lastTime?.location).toBe('Athens')
  })

  it('ignores workouts after the date of the one being edited', async () => {
    const squat = exercise('squat')
    const past = await workout(squat, '2026-09-01', 'Zurich', [])
    await workout(squat, '2026-08-25', 'Zurich', [80, 80])
    await workout(squat, '2026-09-20', 'Zurich', [100, 100, 100, 100])

    const plan = await planExercise(snapshotFromExercise(squat), past)
    expect(plan.lastTime?.date).toBe('2026-08-25')
    expect(plan.targetSets).toBe(3)
    expect(plan.prefill).toEqual({ reps: 5, weight: 80 })
  })

  it('skips a workout that has the exercise without a set of it', async () => {
    const press = exercise('press')
    await workout(press, '2026-10-01', 'Zurich', [30])
    await workout(press, '2026-10-03', 'Zurich', [])

    const plan = await planExercise(snapshotFromExercise(press), undefined)
    expect(plan.lastTime?.date).toBe('2026-10-01')
  })

  it('aims for at least the sets the open workout already holds', async () => {
    const curl = exercise('curl', 2)
    const today = await workout(curl, '2026-10-08', 'Zurich', [10, 10, 12])

    const plan = await planExercise(snapshotFromExercise(curl), today)
    expect(plan.lastTime).toBeUndefined()
    expect(plan.targetSets).toBe(3)
    expect(plan.prefill).toEqual({ reps: 5, weight: 12 })
  })
})
