import { exercisesStore, type Exercise } from './stores/exercisesStore'
import { programsStore, type Program } from './stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from './stores/workoutSessionsStore'

export interface ExportData {
  version: number
  exportDate: string
  stores: {
    exercises: Array<Exercise>
    programs: Array<Program>
    workoutSessions: Array<WorkoutSession>
  }
}

export const exportIndexedDbToJson = async () => {
  const data: ExportData = {
    version: 1,
    exportDate: new Date().toISOString(),
    stores: {
      exercises: await exercisesStore.getAllExercises(),
      programs: await programsStore.getAllPrograms(),
      workoutSessions: await workoutSessionsStore.getAllWorkoutSessions()
    }
  }

  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `jimbro-export-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}
