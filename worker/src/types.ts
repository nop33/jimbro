export interface ExportData {
  version: number
  exportDate: string
  stores: {
    exercises: Array<{ id: string; [key: string]: unknown }>
    programs: Array<{ id: string; [key: string]: unknown }>
    workoutSessions: Array<{ id: string; [key: string]: unknown }>
  }
}

export interface SnapshotCounts {
  exercises: number
  programs: number
  workoutSessions: number
}

export function countsFrom(data: ExportData): SnapshotCounts {
  return {
    exercises: data.stores.exercises.length,
    programs: data.stores.programs.length,
    workoutSessions: data.stores.workoutSessions.length
  }
}
