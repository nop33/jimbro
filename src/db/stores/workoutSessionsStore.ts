import { getWeekOfYear } from '../../dateUtils'
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

export type WorkoutSessionStatus = 'completed' | 'skipped' | 'incomplete' | 'pending'

export class WorkoutSessionsReactiveStore {
  private storeName = OBJECT_STORES.WORKOUT_SESSIONS

  async createWorkoutSession(workoutSession: WorkoutSession): Promise<WorkoutSession> {
    return storage.create(this.storeName, workoutSession)
  }

  async getWorkoutSession(date: string): Promise<WorkoutSession | undefined> {
    return storage.get(this.storeName, date)
  }

  async getLatestCompletedWorkoutSessionOfProgram(programId: Program['id']): Promise<WorkoutSession | undefined> {
    const workoutSessions = await this.getAllWorkoutSessions() // TODO: Improve performance by querying indexedDB instead (also, create an index for programId)
    return workoutSessions
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .find((workoutSession) => workoutSession.programId === programId && workoutSession.status === 'completed')
  }

  async getDateOfFirstWorkoutSession(): Promise<string | undefined> {
    // TODO: Improve performance by querying indexedDB instead
    const workoutSessions = await this.getAllWorkoutSessions()
    return workoutSessions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]?.date
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

  async addExerciseExecutionSetToWorkoutSession({
    workoutSession,
    exerciseId,
    exerciseExecutionSet
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
    exerciseExecutionSet: ExerciseSetExecution
  }): Promise<WorkoutSession> {
    const workoutSessionExercise = workoutSession.exercises.find(({ exerciseId: id }) => id === exerciseId)

    if (!workoutSessionExercise) {
      workoutSession.exercises.push({ exerciseId, sets: [exerciseExecutionSet] })
    } else {
      workoutSessionExercise.sets.push(exerciseExecutionSet)
    }

    return this.updateWorkoutSession(workoutSession)
  }

  async countWorkoutSessions(): Promise<number> {
    return storage.count(this.storeName)
  }

  async deleteWorkoutSession(date: string): Promise<void> {
    const workoutSession = await this.getWorkoutSession(date)
    if (!workoutSession) {
      throw new Error('Workout session not found')
    }
    return storage.delete(this.storeName, date)
  }

  async updateExerciseExecutionSetInWorkoutSession({
    workoutSession,
    exerciseId,
    exerciseExecutionSetIndex,
    exerciseExecutionSet
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
    exerciseExecutionSetIndex: number
    exerciseExecutionSet: ExerciseSetExecution
  }): Promise<WorkoutSession> {
    const workoutSessionExercise = workoutSession.exercises.find(({ exerciseId: id }) => id === exerciseId)
    if (!workoutSessionExercise) {
      throw new Error('Exercise not found')
    }
    workoutSessionExercise.sets[exerciseExecutionSetIndex] = exerciseExecutionSet
    return this.updateWorkoutSession(workoutSession)
  }

  async addExerciseToWorkoutSession({
    workoutSession,
    exerciseId
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
  }): Promise<WorkoutSession> {
    return this.updateWorkoutSession({
      ...workoutSession,
      exercises: [...workoutSession.exercises, { exerciseId, sets: [] }]
    })
  }

  async deleteExerciseFromWorkoutSession({
    workoutSession,
    exerciseId
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
  }): Promise<WorkoutSession> {
    return this.updateWorkoutSession({
      ...workoutSession,
      exercises: workoutSession.exercises.filter(({ exerciseId: id }) => id !== exerciseId)
    })
  }
}

export const workoutSessionsStore = new WorkoutSessionsReactiveStore()
