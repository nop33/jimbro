import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { Exercise } from '../src/db/stores/exercisesStore'
import { snapshotFromExercise, workoutSessionsStore } from '../src/db/stores/workoutSessionsStore'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const bench: Exercise = {
  id: 'bench',
  name: 'Bench press',
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'chest',
  targetSets: 3,
  defaults: { reps: 5 },
  isDeleted: false,
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const start = (date: string, location: string) =>
  workoutSessionsStore.create({
    date,
    programId: 'program',
    location,
    notes: '',
    exercises: [snapshotFromExercise(bench)]
  })

describe('getLatestSaved', () => {
  it('finds nothing before the first workout', async () => {
    await expect(workoutSessionsStore.getLatestSaved()).resolves.toBeUndefined()
  })

  it('gives the latest workout by date that is not deleted, with its sets', async () => {
    const zurich = await start('2026-01-02', 'Zurich')
    await start('2026-01-01', 'Athens')
    await workoutSessionsStore.addSet(zurich, 'bench', { preset: 'lifting', reps: 5, weight: 40 })
    const deleted = await start('2026-01-03', 'Hotel gym')
    await workoutSessionsStore.remove(deleted.id)

    const latest = await workoutSessionsStore.getLatestSaved()
    expect(latest).toMatchObject({ id: zurich.id, date: '2026-01-02', location: 'Zurich', status: 'incomplete' })
    expect(latest?.exercises.map((one) => [one.exerciseId, one.sets])).toEqual([
      ['bench', [{ preset: 'lifting', reps: 5, weight: 40 }]]
    ])
  })
})
