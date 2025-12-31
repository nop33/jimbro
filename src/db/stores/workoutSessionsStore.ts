import { getWeekOfYear } from '../../utils'
import { OBJECT_STORES } from '../constants'
import { storage } from '../storage'
import type { Exercise } from './exercisesStore'
import type { Program } from './programsStore'

export interface WorkoutSession {
  date: string
  programId: Program['id']
  exercises: Array<ExerciseExecution>
  location: string
  status: WorkoutSessionStatus
  notes?: string
}

export interface ExerciseExecution {
  exerciseId: Exercise['id']
  sets: Array<ExerciseSetExecution>
  notes?: string
}

export interface ExerciseSetExecution {
  reps: number
  weight: number
}

export type WorkoutSessionStatus = 'completed' | 'skipped' | 'incomplete'

export class WorkoutSessionsReactiveStore {
  private storeName = OBJECT_STORES.WORKOUT_SESSIONS

  async createWorkoutSession(workoutSession: WorkoutSession): Promise<WorkoutSession> {
    return storage.create(this.storeName, workoutSession)
  }

  async getWorkoutSession(date: string): Promise<WorkoutSession | undefined> {
    return storage.get(this.storeName, date)
  }

  async getLatestWorkoutSessionOfProgram(programId: Program['id']): Promise<WorkoutSession | undefined> {
    const workoutSessions = await this.getAllWorkoutSessions() // TODO: Improve performance by querying indexedDB instead (also, create an index for programId)
    return workoutSessions.find((workoutSession) => workoutSession.programId === programId)
  }

  async getAllWorkoutSessions(): Promise<Array<WorkoutSession>> {
    return storage.getAll(this.storeName)
  }

  async getAllWorkoutSessionsGroupedByWeek(): Promise<Record<string, Array<WorkoutSession>>> {
    const workoutSessions = await this.getAllWorkoutSessions()

    return workoutSessions.reduce((acc, workoutSession) => {
      const week = getWeekOfYear(new Date(workoutSession.date))
      if (acc[week]) {
        acc[week].push(workoutSession)
      } else {
        acc[week] = [workoutSession]
      }
      return acc
    }, {} as Record<string, Array<WorkoutSession>>)
  }

  async updateWorkoutSession(item: WorkoutSession): Promise<WorkoutSession> {
    return storage.update(this.storeName, item)
  }

  async countWorkoutSessions(): Promise<number> {
    return storage.count(this.storeName)
  }
}

export const workoutSessionsStore = new WorkoutSessionsReactiveStore()
