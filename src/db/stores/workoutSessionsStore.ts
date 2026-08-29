import { OBJECT_STORES } from '../constants'
import { nowIso } from '../nowIso'
import { storage } from '../storage'
import type { Exercise, MuscleGroup } from './exercisesStore'
import type { Program } from './programsStore'

export const PERSISTED_WORKOUT_SESSION_STATUSES = ['completed', 'incomplete'] as const
export type PersistedWorkoutSessionStatus = (typeof PERSISTED_WORKOUT_SESSION_STATUSES)[number]

export const UI_WORKOUT_SESSION_STATUSES = ['pending', 'skipped'] as const
export type WorkoutSessionStatus = PersistedWorkoutSessionStatus | (typeof UI_WORKOUT_SESSION_STATUSES)[number]

export interface WorkoutSession {
  id: string
  date: string
  programId: Program['id']
  exercises: Array<ExerciseExecution>
  location: string
  status: PersistedWorkoutSessionStatus
  notes?: string
  updatedAt: string
}

export type NewWorkoutSession = Omit<WorkoutSession, 'id' | 'updatedAt'>

export interface ExerciseExecution {
  exerciseId: Exercise['id']
  name: string
  muscle: MuscleGroup
  targetSets: number
  targetReps: number
  isRehab: boolean
  sets: Array<ExerciseSetExecution>
}

export interface ExerciseSetExecution {
  reps: number
  weight: number
}

export const snapshotFromExercise = (exercise: Exercise): Omit<ExerciseExecution, 'sets'> => ({
  exerciseId: exercise.id,
  name: exercise.name,
  muscle: exercise.muscle,
  targetSets: exercise.targetSets,
  targetReps: exercise.targetReps,
  isRehab: exercise.isRehab
})

export const placeholderSnapshot = (exerciseId: string, loggedSetCount = 0): Omit<ExerciseExecution, 'sets'> => ({
  exerciseId,
  name: '(deleted)',
  muscle: 'core',
  targetSets: Math.max(loggedSetCount, 1),
  targetReps: 0,
  isRehab: false
})

export class WorkoutSessionsStore {
  private storeName = OBJECT_STORES.WORKOUT_SESSIONS

  async createWorkoutSession(item: NewWorkoutSession): Promise<WorkoutSession> {
    const workoutSession: WorkoutSession = { ...item, id: crypto.randomUUID(), updatedAt: nowIso() }
    return storage.create(this.storeName, workoutSession)
  }

  async importWorkoutSession(workoutSession: WorkoutSession): Promise<WorkoutSession> {
    return storage.create(this.storeName, { ...workoutSession, updatedAt: workoutSession.updatedAt || nowIso() })
  }

  async getWorkoutSession(id: string): Promise<WorkoutSession | undefined> {
    return storage.get(this.storeName, id)
  }

  async getLatestCompletedWorkoutSessionOfProgram(programId: Program['id']): Promise<WorkoutSession | undefined> {
    const { parseSimpleDate } = await import('../../dateUtils')
    const programSessions = await storage.getAllByIndex<WorkoutSession>(this.storeName, 'programId', programId)
    return programSessions
      .filter((session) => session.status === 'completed')
      .sort((a, b) => parseSimpleDate(b.date).getTime() - parseSimpleDate(a.date).getTime())[0]
  }

  async getLatestWorkoutSessionWithCompletedExercise(
    exerciseId: Exercise['id'],
    requiredSets: number,
    location?: string
  ): Promise<WorkoutSession | undefined> {
    const session = await storage.getFirstByPredicate<WorkoutSession>(this.storeName, 'date', 'prev', (session) => {
      if (location && session.location !== location) return false
      const exercise = session.exercises.find((e) => e.exerciseId === exerciseId)
      return !!exercise && exercise.sets.length >= requiredSets
    })

    if (session) return session
    if (!location) return undefined

    return storage.getFirstByPredicate<WorkoutSession>(this.storeName, 'date', 'prev', (session) => {
      const exercise = session.exercises.find((e) => e.exerciseId === exerciseId)
      return !!exercise && exercise.sets.length >= requiredSets
    })
  }

  async getDateOfFirstWorkoutSession(): Promise<string | undefined> {
    const earliest = await storage.getFirstByIndex<WorkoutSession>(this.storeName, 'date', 'next')
    return earliest?.date
  }

  async getAllWorkoutSessions(): Promise<Array<WorkoutSession>> {
    return storage.getAll(this.storeName)
  }

  async getAllWorkoutSessionsGroupedByWeek(): Promise<Record<string, Array<WorkoutSession>>> {
    const { getWeekOfYear, parseSimpleDate } = await import('../../dateUtils')
    const workoutSessions = await this.getAllWorkoutSessions()

    const grouped = workoutSessions.reduce(
      (acc, workoutSession) => {
        const week = getWeekOfYear(parseSimpleDate(workoutSession.date))
        if (acc[week]) {
          acc[week].push(workoutSession)
        } else {
          acc[week] = [workoutSession]
        }
        return acc
      },
      {} as Record<string, Array<WorkoutSession>>
    )

    for (const week in grouped) {
      grouped[week].sort((a, b) => parseSimpleDate(a.date).getTime() - parseSimpleDate(b.date).getTime())
    }

    return grouped
  }

  async updateWorkoutSession(item: WorkoutSession): Promise<WorkoutSession> {
    return storage.update(this.storeName, { ...item, updatedAt: nowIso() })
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
      throw new Error('Exercise not found in workout session')
    }

    workoutSessionExercise.sets.push(exerciseExecutionSet)

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
    exercise
  }: {
    workoutSession: WorkoutSession
    exercise: ExerciseExecution
  }): Promise<WorkoutSession> {
    return this.updateWorkoutSession({
      ...workoutSession,
      exercises: [...workoutSession.exercises, exercise]
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
    replacement
  }: {
    workoutSession: WorkoutSession
    oldExerciseId: Exercise['id']
    replacement: ExerciseExecution
  }): Promise<WorkoutSession> {
    const exerciseIndex = workoutSession.exercises.findIndex(({ exerciseId }) => exerciseId === oldExerciseId)
    if (exerciseIndex === -1) {
      throw new Error('Exercise not found in workout session')
    }

    const updatedExercises = [...workoutSession.exercises]
    updatedExercises[exerciseIndex] = replacement

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
