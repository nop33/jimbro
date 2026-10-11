import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { Exercise } from '../src/db/stores/exercisesStore'
import { snapshotFromExercise, workoutSessionsStore } from '../src/db/stores/workoutSessionsStore'
import { keptLastTimes, nextSetValues, planExercise, prefillIsMaxWeight } from '../src/pages/gymtime/exercisePlan'

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
    const today = await workout(bench, '2026-10-08', 'Zurich', [40])

    const plan = await planExercise(snapshotFromExercise(bench), today)

    expect(plan.lastTime).toMatchObject({
      date: '2026-10-01',
      sets: [lift(40), lift(45), lift(50), lift(50), lift(50)]
    })
    expect(plan.prefill).toEqual({ reps: 5, weight: 40 })
    expect(plan.prefillIsMax).toBe(false)
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
    expect(plan.prefill).toEqual({ reps: 5, weight: 80 })
  })

  it('skips a workout that has the exercise without a set of it', async () => {
    const press = exercise('press')
    await workout(press, '2026-10-01', 'Zurich', [30])
    await workout(press, '2026-10-03', 'Zurich', [])

    const plan = await planExercise(snapshotFromExercise(press), { date: '2026-10-08', location: 'Zurich' })
    expect(plan.lastTime?.date).toBe('2026-10-01')
  })

  it('shows before the start the target the start stores at the planned gym', async () => {
    const dip = exercise('dip', 3)
    await workout(dip, '2026-10-01', 'Zurich', [0, 0, 0, 0, 0])
    await workout(dip, '2026-10-05', 'Athens', [0, 0])

    for (const [location, target] of [
      ['Zurich', 5],
      ['Athens', 3]
    ] as const) {
      const planned = { date: '2026-10-08', location }
      const preview = await planExercise(snapshotFromExercise(dip), planned)
      expect(preview.progress).toEqual({ logged: 0, target, done: false })

      const started = await workout(dip, planned.date, location, [])
      expect(started.exercises[0].targetSets).toBe(target)
      expect((await planExercise(started.exercises[0], started)).progress).toEqual(preview.progress)
    }
  })

  it("follows the session's progress once it starts", async () => {
    const curl = exercise('curl', 2)
    const today = await workout(curl, '2026-10-08', 'Zurich', [10])
    expect((await planExercise(today.exercises[0], today)).progress).toEqual({ logged: 1, target: 2, done: false })

    const done = await workoutSessionsStore.addSet(today, 'curl', lift(10))
    expect((await planExercise(done.exercises[0], done)).progress).toEqual({ logged: 2, target: 2, done: true })
  })
})

describe('keptLastTimes', () => {
  it('keeps last time for a workout, and reads it again for another day or gym', async () => {
    const raise = exercise('raise')
    await workout(raise, '2026-10-01', 'Zurich', [10])
    const today = await workout(raise, '2026-10-08', 'Zurich', [])
    const lastTimes = keptLastTimes()
    const plan = () => planExercise(today.exercises[0], today, lastTimes)

    expect((await plan()).lastTime?.sets).toEqual([lift(10)])
    await workout(raise, '2026-10-05', 'Zurich', [12])
    expect((await plan()).lastTime?.sets).toEqual([lift(10)])
    expect(
      (await planExercise(today.exercises[0], { ...today, location: 'Athens' }, lastTimes)).lastTime?.sets
    ).toEqual([lift(12)])
  })
})

describe('nextSetValues', () => {
  const snapshot = snapshotFromExercise(exercise('fly'))
  const lastTime = { date: '2026-10-01', location: 'Zurich', sets: [lift(40), lift(50), lift(45)] }

  it("starts from last time's heaviest weight, and says so when the weights differed", () => {
    expect(nextSetValues(snapshot, [], lastTime)).toEqual({ reps: 5, weight: 50 })
    expect(prefillIsMaxWeight(snapshot, [], lastTime)).toBe(true)

    const even = { ...lastTime, sets: [lift(50), lift(50), lift(50)] }
    expect(nextSetValues(snapshot, [], even)).toEqual({ reps: 5, weight: 50 })
    expect(prefillIsMaxWeight(snapshot, [], even)).toBe(false)
  })

  it("repeats today's latest set once there is one, with no max to tell", () => {
    expect(nextSetValues(snapshot, [lift(42.5)], lastTime)).toEqual({ reps: 5, weight: 42.5 })
    expect(prefillIsMaxWeight(snapshot, [lift(42.5)], lastTime)).toBe(false)
  })

  it("uses the exercise's defaults with no last time", () => {
    expect(nextSetValues(snapshot, [], undefined)).toEqual({ reps: 5 })
    expect(prefillIsMaxWeight(snapshot, [], undefined)).toBe(false)
  })
})
