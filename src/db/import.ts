import { OBJECT_STORES } from './constants'
import { CURRENT_EXPORT_VERSION, type ExportData } from './export'
import { db } from '.'
import type { Exercise } from './stores/exercisesStore'
import type { Program } from './stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from './stores/workoutSessionsStore'
import { storage } from './storage'

interface V1WorkoutSession extends Omit<WorkoutSession, 'id'> {
  id?: string
}

export const importIndexedDbFromJson = async (file: File) => {
  const text = await file.text()
  const data: ExportData = JSON.parse(text)
  const { version, stores } = data

  if (version > CURRENT_EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${version}. Please update the app.`)
  }

  try {
    await importExercises(stores.exercises)
    await importPrograms(stores.programs)
    await importWorkoutSessions(stores.workoutSessions, version)

    console.log('✅ Imported data successfully')
  } catch (error) {
    console.error('❌ Failed to import data', error)
    throw error
  }
}

const importExercises = async (exercises: ExportData['stores']['exercises']) => {
  const allExisting = await storage.getAll<Exercise>(OBJECT_STORES.EXERCISES)
  const existingIds = new Set(allExisting.map((e) => e.id))

  for (const exercise of exercises) {
    if (!existingIds.has(exercise.id)) {
      await db.exercises.create(exercise)
    }
  }
}

const importPrograms = async (programs: ExportData['stores']['programs']) => {
  const allExisting = await storage.getAll<Program>(OBJECT_STORES.PROGRAMS)
  const existingIds = new Set(allExisting.map((p) => p.id))

  for (const program of programs) {
    if (!existingIds.has(program.id)) {
      await db.programs.create(program)
    }
  }
}

const importWorkoutSessions = async (workoutSessions: Array<V1WorkoutSession | WorkoutSession>, version: number) => {
  const allExisting = await storage.getAll<WorkoutSession>(OBJECT_STORES.WORKOUT_SESSIONS)
  const existingIds = new Set<string>()
  const existingSessionsKeys = new Set<string>()

  for (const s of allExisting) {
    existingIds.add(s.id)
    existingSessionsKeys.add(`${s.date}|${s.programId}`)
  }

  for (const session of workoutSessions) {
    if (version === 1 || !session.id) {
      const alreadyExists = existingSessionsKeys.has(`${session.date}|${session.programId}`)
      if (!alreadyExists) {
        const { id: _id, ...sessionWithoutId } = session as WorkoutSession
        await workoutSessionsStore.createWorkoutSession(sessionWithoutId)
      }
    } else {
      if (!existingIds.has(session.id)) {
        await workoutSessionsStore.importWorkoutSession(session as WorkoutSession)
      }
    }
  }
}
