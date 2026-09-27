import { expect, test } from '@playwright/test'

test('writeRows stores nothing when a later put throws', async ({ page }) => {
  await page.goto('/settings/')
  const result = await page.evaluate(async () => {
    const { storage } = await import('/src/db/storage.ts')
    let rejected = false
    try {
      await storage.writeRows([
        { table: 'exercises', row: { id: 'keep-me', name: 'Keep' } },
        { table: 'exercises', row: { name: 'missing-id' } }
      ] as never)
    } catch {
      rejected = true
    }
    const kept = await storage.get('exercises', 'keep-me')
    return { rejected, kept: kept !== undefined }
  })
  expect(result).toEqual({ rejected: true, kept: false })
})

test('a new set reuses the legacy id of a tombstoned row', async ({ page }) => {
  await page.goto('/settings/')
  const result = await page.evaluate(async () => {
    const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
    const { legacySetId } = await import('/src/sync/rows.ts')
    const { storage } = await import('/src/db/storage.ts')
    const exerciseId = 'ex-legacy'
    const execution = {
      exerciseId,
      name: 'Bench press',
      kind: 'lifting' as const,
      preset: 'lifting' as const,
      muscle: 'chest' as const,
      targetSets: 3,
      defaults: { reps: 8 },
      sets: [] as Array<{ preset: 'lifting'; reps: number; weight: number }>
    }
    const created = await workoutSessionsStore.createWorkoutSession({
      date: '2026-03-01',
      programId: 'prog-legacy',
      location: 'Zurich',
      status: 'incomplete',
      exercises: [execution]
    })
    const logged = await workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
      workoutSession: created,
      exerciseId,
      exerciseExecutionSet: { preset: 'lifting', reps: 8, weight: 40 }
    })
    const removed = await workoutSessionsStore.deleteExerciseFromWorkoutSession({
      workoutSession: logged,
      exerciseId
    })
    await workoutSessionsStore.addExerciseToWorkoutSession({
      workoutSession: removed,
      exercise: { ...execution, sets: [{ preset: 'lifting', reps: 5, weight: 20 }] }
    })
    const sets = (await storage.getAll('sets')) as Array<{
      id: string
      sessionId: string
      exerciseId: string
      isDeleted: boolean
      set: { weight: number }
    }>
    const rows = sets.filter((set) => set.sessionId === created.id && set.exerciseId === exerciseId)
    return {
      id: rows[0]?.id,
      expected: legacySetId(created.id, exerciseId, 0),
      count: rows.length,
      isDeleted: rows[0]?.isDeleted,
      weight: rows[0]?.set.weight
    }
  })
  expect(result.count).toBe(1)
  expect(result.id).toBe(result.expected)
  expect(result.isDeleted).toBe(false)
  expect(result.weight).toBe(20)
})
