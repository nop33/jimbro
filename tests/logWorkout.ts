import type { Page } from '@playwright/test'

// Starts a workout of the program at `index` on `date`, finished when `finished` is true. Resolves to the program.
export const logWorkout = (page: Page, index: number, date: string, finished: boolean) =>
  page.evaluate(
    async ({ index, date, finished }) => {
      const { programsStore } = await import('/src/db/stores/programsStore.ts')
      const { snapshotFromExercise, workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const program = (await programsStore.load())[index]
      const bench = {
        id: 'home-bench',
        name: 'Bench',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'chest',
        targetSets: 1,
        defaults: { reps: 5 },
        isDeleted: false,
        updatedAt: '2026-10-01T12:00:00.000Z'
      } as const
      const session = await workoutSessionsStore.create({
        date,
        programId: program.id,
        location: '',
        exercises: [snapshotFromExercise(bench)]
      })
      if (finished) await workoutSessionsStore.addSet(session, bench.id, { preset: 'lifting', reps: 5, weight: 60 })
      return { id: program.id, name: program.name, sessionId: session.id }
    },
    { index, date, finished }
  )
