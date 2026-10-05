import { exportFromRows } from '../sync/rows'
import type { ExerciseRow, ExportedFile, ProgramRow, SessionHeader, SetRow } from './types'
import { OBJECT_STORES } from './constants'
import { getSimpleDate } from '../dateUtils'
import { storage } from './storage'

export const CURRENT_EXPORT_VERSION = 4

export const buildExportData = async (): Promise<ExportedFile> => {
  const [exercises, programs, sessions, sets] = await Promise.all([
    storage.getAll<ExerciseRow>(OBJECT_STORES.EXERCISES),
    storage.getAll<ProgramRow>(OBJECT_STORES.PROGRAMS),
    storage.getAll<SessionHeader>(OBJECT_STORES.WORKOUT_SESSIONS),
    storage.getAll<SetRow>(OBJECT_STORES.SETS)
  ])
  return exportFromRows({
    version: CURRENT_EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    exercises,
    programs,
    sessions,
    sets
  })
}

const downloadExportDataAsFile = (data: ExportedFile) => {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `jimbro-export-${getSimpleDate(new Date())}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export const exportIndexedDbToJson = async () => {
  const data = await buildExportData()
  downloadExportDataAsFile(data)
}
