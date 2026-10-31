import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vite-plus/test'
import { OBJECT_STORES } from '../src/db/constants'
import type { Exercise } from '../src/db/stores/exercisesStore'
import {
  catalogSnapshots,
  nextUnfinished,
  progressOf,
  snapshotFromExercise,
  workoutSessionsStore
} from '../src/db/stores/workoutSessionsStore'
import { storage } from '../src/db/storage'
import type { SessionHeader, SetRow, WorkoutSession } from '../src/db/types'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const exercise = (id: string, targetSets: number): Exercise => ({
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

const start = (...exercises: Array<Exercise>) =>
  workoutSessionsStore.create({
    date: '2026-10-01',
    programId: 'program',
    location: 'Zurich',
    exercises: exercises.map(snapshotFromExercise)
  })

const storedStatus = async (session: WorkoutSession) => (await workoutSessionsStore.getById(session.id))?.status

// Stores a header whose status disagrees with its sets, as a session written by another device or an older
// version can arrive.
const storeStaleStatus = async (session: WorkoutSession, status: SessionHeader['status']) => {
  const header = await storage.get<SessionHeader>(OBJECT_STORES.WORKOUT_SESSIONS, session.id)
  if (!header) throw new Error('session not stored')
  await storage.writeRows([{ table: 'sessions', row: { ...header, status } }])
  return { ...session, status }
}

describe('workoutSessionsStore', () => {
  it('plans a program with the exercises the catalog has, a deleted one included, and leaves out an unknown ID', async () => {
    const bench = exercise('plan-bench', 3)
    const gone = { ...exercise('plan-gone', 2), isDeleted: true }
    await storage.writeRows([bench, gone].map((row) => ({ table: 'exercises' as const, row })))
    const snapshots = await catalogSnapshots(['plan-bench', 'plan-missing', 'plan-gone'])
    expect(snapshots.map(({ exerciseId }) => exerciseId)).toEqual(['plan-bench', 'plan-gone'])
    expect(snapshots[0]).toEqual(snapshotFromExercise(bench))
  })

  it('stores the status the sets give with every change', async () => {
    let session = await start(exercise('bench', 1))
    expect(session.status).toBe('incomplete')

    session = await workoutSessionsStore.addSet(session, 'bench', lift(40))
    expect([session.status, await storedStatus(session)]).toEqual(['completed', 'completed'])

    session = await workoutSessionsStore.addExercise(session, exercise('row', 1))
    expect([session.status, await storedStatus(session)]).toEqual(['incomplete', 'incomplete'])

    session = await workoutSessionsStore.removeExercise(session, 'row')
    expect([session.status, await storedStatus(session)]).toEqual(['completed', 'completed'])

    session = await workoutSessionsStore.swapExercise(session, 'bench', exercise('squat', 1))
    expect([session.status, await storedStatus(session)]).toEqual(['incomplete', 'incomplete'])
  })

  it('heals a stale status on writes that leave the set count alone', async () => {
    const logged = await workoutSessionsStore.addSet(
      await start(exercise('bench', 2), exercise('row', 1)),
      'bench',
      lift(40)
    )

    const edited = await workoutSessionsStore.updateSet(
      await storeStaleStatus(logged, 'completed'),
      'bench',
      0,
      lift(45)
    )
    expect([edited.status, await storedStatus(edited)]).toEqual(['incomplete', 'incomplete'])

    const moved = await workoutSessionsStore.moveExercise(await storeStaleStatus(edited, 'completed'), 'row', 'up')
    expect([moved.status, await storedStatus(moved)]).toEqual(['incomplete', 'incomplete'])

    const renamed = await workoutSessionsStore.update(await storeStaleStatus(moved, 'completed'), { location: 'Bern' })
    expect([renamed.status, await storedStatus(renamed)]).toEqual(['incomplete', 'incomplete'])
  })

  it('leaves the session it was given as it was', async () => {
    const session = await start(exercise('bench', 3), exercise('row', 3))
    const writes: Array<(session: WorkoutSession) => Promise<WorkoutSession>> = [
      (current) => workoutSessionsStore.addSet(current, 'bench', lift(40)),
      (current) => workoutSessionsStore.updateSet(current, 'bench', 0, lift(45)),
      (current) => workoutSessionsStore.addSet(current, 'bench', lift(50)),
      (current) => workoutSessionsStore.removeSet(current, 'bench', 1),
      (current) => workoutSessionsStore.addSetSlot(current, 'row'),
      (current) => workoutSessionsStore.removeSetSlot(current, 'row'),
      (current) => workoutSessionsStore.moveExercise(current, 'row', 'up'),
      (current) => workoutSessionsStore.addExercise(current, exercise('squat', 3)),
      (current) => workoutSessionsStore.swapExercise(current, 'squat', exercise('lunge', 3)),
      (current) => workoutSessionsStore.removeExercise(current, 'lunge'),
      (current) => workoutSessionsStore.update(current, { notes: 'Felt strong' })
    ]

    let current = session
    for (const write of writes) {
      const before = structuredClone(current)
      const next = await write(current)
      expect(current).toEqual(before)
      current = next
    }
    // Bench went 40, then 45, then 45 and 50, then 45 again.
    expect(current.exercises.map(({ exerciseId, sets }) => [exerciseId, sets])).toEqual([
      ['row', []],
      ['bench', [lift(45)]]
    ])
    expect(await workoutSessionsStore.getById(session.id)).toEqual(current)
  })

  it('keeps each exercise once', async () => {
    const session = await start(exercise('bench', 1), exercise('row', 1))
    await expect(workoutSessionsStore.addExercise(session, exercise('bench', 1))).rejects.toThrow('already exists')
    await expect(workoutSessionsStore.swapExercise(session, 'bench', exercise('row', 1))).rejects.toThrow(
      'already exists'
    )
  })

  it('stays incomplete after an added set slot until that set is logged', async () => {
    let session = await workoutSessionsStore.addSet(await start(exercise('pull', 1)), 'pull', lift(10))
    expect(session.status).toBe('completed')

    session = await workoutSessionsStore.addSetSlot(session, 'pull')
    expect([session.exercises[0].targetSets, session.status, await storedStatus(session)]).toEqual([
      2,
      'incomplete',
      'incomplete'
    ])

    session = await workoutSessionsStore.addSet(session, 'pull', lift(10))
    expect(session.status).toBe('completed')
  })

  it('removes a set to do, never below the sets logged or below 1', async () => {
    let session = await workoutSessionsStore.addSet(await start(exercise('pull', 3)), 'pull', lift(10))
    session = await workoutSessionsStore.removeSetSlot(session, 'pull')
    expect([session.exercises[0].targetSets, session.status]).toEqual([2, 'incomplete'])

    // Removing the last set to do finishes the exercise, and here the workout.
    session = await workoutSessionsStore.removeSetSlot(session, 'pull')
    expect([session.exercises[0].targetSets, session.status, await storedStatus(session)]).toEqual([
      1,
      'completed',
      'completed'
    ])
    await expect(workoutSessionsStore.removeSetSlot(session, 'pull')).rejects.toThrow('No set left')

    const fresh = await start(exercise('row', 1))
    await expect(workoutSessionsStore.removeSetSlot(fresh, 'row')).rejects.toThrow('No set left')
  })

  it('removes a logged set, moving the later ones up and leaving its slot to do', async () => {
    let session = await start(exercise('bench', 3), exercise('row', 1))
    for (const weight of [40, 50, 60]) session = await workoutSessionsStore.addSet(session, 'bench', lift(weight))
    session = await workoutSessionsStore.addSet(session, 'row', lift(30))
    expect(session.status).toBe('completed')

    session = await workoutSessionsStore.removeSet(session, 'bench', 0)
    expect(session.exercises[0].sets).toEqual([lift(50), lift(60)])
    expect([progressOf(session.exercises[0]).target, session.status]).toEqual([3, 'incomplete'])
    expect(await workoutSessionsStore.getById(session.id)).toEqual(session)

    // The next set takes the freed position again.
    session = await workoutSessionsStore.addSet(session, 'bench', lift(70))
    expect(session.exercises[0].sets).toEqual([lift(50), lift(60), lift(70)])
    expect(await workoutSessionsStore.getById(session.id)).toEqual(session)
    await expect(workoutSessionsStore.removeSet(session, 'row', 1)).rejects.toThrow('Set not found')
  })

  it("starts each exercise at its target, or last time's set count at the gym when more", async () => {
    // Last time: four sets of each at Geneva, then one at Basel.
    for (const [date, location, sets] of [
      ['2026-09-01', 'Geneva', 4],
      ['2026-09-05', 'Basel', 1]
    ] as const) {
      let earlier = await workoutSessionsStore.create({
        date,
        programId: 'program',
        location,
        exercises: ['fly', 'dip', 'lunge'].map((id) => snapshotFromExercise(exercise(id, 2)))
      })
      for (const id of ['fly', 'dip', 'lunge']) {
        for (let set = 0; set < sets; set++) earlier = await workoutSessionsStore.addSet(earlier, id, lift(20))
      }
    }

    const targets = (session: WorkoutSession) =>
      session.exercises.map(({ exerciseId, targetSets }) => [exerciseId, targetSets])
    const at = (location: string) =>
      workoutSessionsStore.create({
        date: '2026-09-10',
        programId: 'program',
        location,
        exercises: [snapshotFromExercise(exercise('fly', 2)), snapshotFromExercise(exercise('curl', 3))]
      })

    const inGeneva = await at('Geneva')
    expect(targets(inGeneva)).toEqual([
      ['fly', 4],
      ['curl', 3]
    ])
    expect(targets(await at('Basel'))).toEqual([
      ['fly', 2],
      ['curl', 3]
    ])

    const added = await workoutSessionsStore.addExercise(inGeneva, exercise('dip', 2))
    const swapped = await workoutSessionsStore.swapExercise(added, 'curl', exercise('lunge', 5))
    expect(targets(swapped)).toEqual([
      ['fly', 4],
      ['lunge', 5],
      ['dip', 4]
    ])
    expect(await workoutSessionsStore.getById(swapped.id)).toEqual(swapped)
  })

  it('goes on to the next exercise with sets to do, wrapping round', async () => {
    let session = await start(exercise('press', 1), exercise('shrug', 1), exercise('crunch', 1))
    session = await workoutSessionsStore.addSet(session, 'shrug', lift(30))
    expect(progressOf(session.exercises[1])).toEqual({ logged: 1, target: 1, done: true })
    expect(nextUnfinished(session, 'press')?.exerciseId).toBe('crunch')
    expect(nextUnfinished(session, 'crunch')?.exerciseId).toBe('press')

    session = await workoutSessionsStore.addSet(session, 'press', lift(30))
    expect(nextUnfinished(session, 'crunch')).toBeUndefined()
  })

  it('gives a set logged again after its exercise left and came back the id of the row it replaces', async () => {
    // A set row's id is session:exercise:position, so the server keeps one row per slot: the deleted set comes
    // back alive with the new values instead of a second row next to it.
    const created = await start(exercise('bench', 3))
    const logged = await workoutSessionsStore.addSet(created, 'bench', lift(40))
    const removed = await workoutSessionsStore.removeExercise(logged, 'bench')
    const readded = await workoutSessionsStore.addExercise(removed, exercise('bench', 3))
    await workoutSessionsStore.addSet(readded, 'bench', lift(20))

    const rows = (await storage.getAll<SetRow>(OBJECT_STORES.SETS)).filter((row) => row.sessionId === created.id)
    expect(rows.map(({ id, isDeleted, set }) => ({ id, isDeleted, set }))).toEqual([
      { id: `${created.id}:bench:0`, isDeleted: false, set: lift(20) }
    ])
  })
})
