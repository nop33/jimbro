import { OBJECT_STORES } from '../constants'
import { storage } from '../storage'
import type { Exercise } from './exercisesStore'
import type { Program } from './programsStore'

export interface WorkoutSession {
  id: string
  date: string
  programId: Program['id']
  exercises: Array<ExerciseExecution>
  location: string
  status: WorkoutSessionStatus
  notes?: string
}

export type NewWorkoutSession = Omit<WorkoutSession, 'id'>

export interface ExerciseExecution {
  exerciseId: Exercise['id']
  sets: Array<ExerciseSetExecution>
  notes?: string
}

export interface ExerciseSetExecution {
  reps: number
  weight: number
}

const WORKOUT_SESSION_STATUSES = ['completed', 'skipped', 'incomplete', 'pending'] as const
export type WorkoutSessionStatus = (typeof WORKOUT_SESSION_STATUSES)[number]

export class WorkoutSessionsStore {
  private storeName = OBJECT_STORES.WORKOUT_SESSIONS

  async createWorkoutSession(item: NewWorkoutSession): Promise<WorkoutSession> {
    const workoutSession: WorkoutSession = { ...item, id: crypto.randomUUID() }
    return storage.create(this.storeName, workoutSession)
  }

  async importWorkoutSession(workoutSession: WorkoutSession): Promise<WorkoutSession> {
    return storage.create(this.storeName, workoutSession)
  }

  async getWorkoutSession(id: string): Promise<WorkoutSession | undefined> {
    return storage.get(this.storeName, id)
  }

  async getLatestCompletedWorkoutSessionOfProgram(programId: Program['id']): Promise<WorkoutSession | undefined> {
    const programSessions = await storage.getAllByIndex<WorkoutSession>(this.storeName, 'programId', programId)
    return programSessions
      .filter((session) => session.status === 'completed')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
  }

  async getLatestWorkoutSessionWithCompletedExercise(
    exerciseId: Exercise['id'],
    requiredSets: number
  ): Promise<WorkoutSession | undefined> {
    return storage.getFirstByPredicate<WorkoutSession>(
      this.storeName,
      'date',
      'prev',
      (session) => {
        const exercise = session.exercises.find((e) => e.exerciseId === exerciseId)
        return !!exercise && exercise.sets.length >= requiredSets
      }
    )
  }

  async getDateOfFirstWorkoutSession(): Promise<string | undefined> {
    const earliest = await storage.getFirstByIndex<WorkoutSession>(this.storeName, 'date', 'next')
    return earliest?.date
  }

  async getAllWorkoutSessions(): Promise<Array<WorkoutSession>> {
    return storage.getAll(this.storeName)
  }

  async getAllWorkoutSessionsGroupedByWeek(): Promise<Record<string, Array<WorkoutSession>>> {
    const { getWeekOfYear } = await import('../../dateUtils')
    const workoutSessions = await this.getAllWorkoutSessions()

    return workoutSessions.reduce(
      (acc, workoutSession) => {
        const week = getWeekOfYear(new Date(workoutSession.date))
        if (acc[week]) {
          acc[week].push(workoutSession)
        } else {
          acc[week] = [workoutSession]
        }
        return acc
      },
      {} as Record<string, Array<WorkoutSession>>
    )
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

  async deleteWorkoutSession(id: string): Promise<void> {
    const workoutSession = await this.getWorkoutSession(id)
    if (!workoutSession) {
      throw new Error('Workout session not found')
    }
    return storage.delete(this.storeName, id)
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

  async swapExerciseInWorkoutSession({
    workoutSession,
    oldExerciseId,
    newExerciseId
  }: {
    workoutSession: WorkoutSession
    oldExerciseId: Exercise['id']
    newExerciseId: Exercise['id']
  }): Promise<WorkoutSession> {
    const exerciseIndex = workoutSession.exercises.findIndex(({ exerciseId }) => exerciseId === oldExerciseId)
    if (exerciseIndex === -1) {
      throw new Error('Exercise not found in workout session')
    }

    const updatedExercises = [...workoutSession.exercises]
    updatedExercises[exerciseIndex] = {
      exerciseId: newExerciseId,
      sets: []
    }

    return this.updateWorkoutSession({
      ...workoutSession,
      exercises: updatedExercises
    })
  }

  async moveExerciseInWorkoutSession({
    workoutSession,
    exerciseId,
    direction
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
    direction: 'up' | 'down'
  }): Promise<WorkoutSession> {
    const exerciseIndex = workoutSession.exercises.findIndex(({ exerciseId: id }) => id === exerciseId)
    if (exerciseIndex === -1) {
      throw new Error('Exercise not found in workout session')
    }

    if (direction === 'up' && exerciseIndex === 0) {
      return workoutSession
    }

    if (direction === 'down' && exerciseIndex === workoutSession.exercises.length - 1) {
      return workoutSession
    }

    const updatedExercises = [...workoutSession.exercises]
    const swapIndex = direction === 'up' ? exerciseIndex - 1 : exerciseIndex + 1
    const temp = updatedExercises[swapIndex]
    updatedExercises[swapIndex] = updatedExercises[exerciseIndex]
    updatedExercises[exerciseIndex] = temp

    return this.updateWorkoutSession({
      ...workoutSession,
      exercises: updatedExercises
    })
  }
}

export const workoutSessionsStore = new WorkoutSessionsStore()
