import { rowsFromExport } from '../sync/rows'
import type { ExportShape, Row, SessionHeader, SetRow, WorkoutSession } from './types'
import { OBJECT_STORES } from './constants'
import { CURRENT_EXPORT_VERSION } from './export'
import { nowIso } from './nowIso'
import { upgradeExerciseRecord, upgradeProgramRecord, upgradeWorkoutSessionRecord } from './schemaUpgrade'
import type { Exercise } from './stores/exercisesStore'
import type { Program } from './stores/programsStore'
import { storage } from './storage'

export const importIndexedDbFromJson = async (file: File) => {
  const text = await file.text()
  const data: ExportShape = JSON.parse(text)
  const { version, stores } = data

  if (version > CURRENT_EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${version}. Please update the app.`)
  }

  try {
    const now = nowIso()
    const exercises = (stores.exercises ?? []).map((raw) =>
      upgradeExerciseRecord(raw as unknown as Record<string, unknown>, now)
    )
    const programs = (stores.programs ?? []).map((raw) =>
      upgradeProgramRecord(raw as unknown as Record<string, unknown>, now)
    )
    const catalog = new Map(exercises.map((exercise) => [exercise.id, exercise]))
    const workoutSessions = (stores.workoutSessions ?? []).map((raw) =>
      upgradeWorkoutSessionRecord(raw as unknown as Record<string, unknown>, catalog, now)
    )

    const [existingExercises, existingPrograms, existingHeaders, existingSets] = await Promise.all([
      storage.getAll<Exercise>(OBJECT_STORES.EXERCISES),
      storage.getAll<Program>(OBJECT_STORES.PROGRAMS),
      storage.getAll<SessionHeader>(OBJECT_STORES.WORKOUT_SESSIONS),
      storage.getAll<SetRow>(OBJECT_STORES.SETS)
    ])
    const exerciseIds = new Set(existingExercises.map((exercise) => exercise.id))
    const programIds = new Set(existingPrograms.map((program) => program.id))
    const sessionIds = new Set(existingHeaders.map((header) => header.id))
    const sessionKeys = new Set(existingHeaders.map((header) => `${header.date}|${header.programId}`))
    const setIds = new Set(existingSets.map((set) => set.id))

    const sessionsToImport: Array<WorkoutSession> = []
    for (const session of workoutSessions) {
      if (version === 1 || !session.id) {
        const key = `${session.date}|${session.programId}`
        if (sessionKeys.has(key)) continue
        session.id = crypto.randomUUID()
        sessionKeys.add(key)
      }
      sessionsToImport.push(session)
    }

    const bundle = rowsFromExport({
      version,
      exportDate: data.exportDate,
      stores: { exercises, programs, workoutSessions: sessionsToImport }
    })

    const writes: Array<Row> = []
    for (const row of bundle.exercises) {
      if (!exerciseIds.has(row.id)) writes.push({ table: 'exercises', row })
    }
    for (const row of bundle.programs) {
      if (!programIds.has(row.id)) writes.push({ table: 'programs', row })
    }
    for (const row of bundle.sessions) {
      if (!sessionIds.has(row.id)) writes.push({ table: 'sessions', row })
    }
    for (const row of bundle.sets) {
      if (!setIds.has(row.id)) writes.push({ table: 'sets', row })
    }
    await storage.writeRows(writes)

    console.log('✅ Imported data successfully')
  } catch (error) {
    console.error('❌ Failed to import data', error)
    throw error
  }
}
