import ReactiveStore from '../db/reactiveStore'
import type { Exercise } from '../db/stores/exercisesStore'
import {
  workoutSessionsStore,
  type ExerciseSetExecution,
  type NewWorkoutSession,
  type WorkoutSession
} from '../db/stores/workoutSessionsStore'

class GymtimeSessionState {
  private static store = new ReactiveStore<WorkoutSession | undefined>(undefined)

  static get session(): WorkoutSession | undefined {
    return this.store.get()
  }

  static initialize(session?: WorkoutSession) {
    this.store.set(session)
  }

  static subscribe(callback: (session: WorkoutSession | undefined) => void): () => void {
    return this.store.subscribe(callback)
  }

  static async create(data: NewWorkoutSession): Promise<WorkoutSession> {
    const session = await workoutSessionsStore.createWorkoutSession(data)
    this.store.set(session)
    return session
  }

  static async update(updates: Partial<Pick<WorkoutSession, 'date' | 'location' | 'notes'>>): Promise<WorkoutSession> {
    const current = this.requireSession()
    const updated = await workoutSessionsStore.updateWorkoutSession({ ...current, ...updates })
    this.store.set(updated)
    return updated
  }

  static hasExercise(exerciseId: string): boolean {
    const session = this.store.get()
    if (!session) return false
    return session.exercises.some(e => e.exerciseId === exerciseId)
  }

  static async swapExercise(oldExerciseId: string, newExerciseId: string): Promise<WorkoutSession> {
    const current = this.requireSession()

    if (this.hasExercise(newExerciseId)) {
      throw new Error('Exercise already exists in workout session')
    }

    const updated = await workoutSessionsStore.swapExerciseInWorkoutSession({
      workoutSession: current,
      oldExerciseId,
      newExerciseId
    })
    this.store.set(updated)
    return updated
  }

  static async addSet(exerciseId: string, set: ExerciseSetExecution): Promise<WorkoutSession> {
    const current = this.requireSession()
    const updated = await workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
      workoutSession: current,
      exerciseId,
      exerciseExecutionSet: set
    })
    this.store.set(updated)
    return updated
  }

  static async updateSet(
    exerciseId: string,
    setIndex: number,
    set: ExerciseSetExecution
  ): Promise<WorkoutSession> {
    const current = this.requireSession()
    const updated = await workoutSessionsStore.updateExerciseExecutionSetInWorkoutSession({
      workoutSession: current,
      exerciseId,
      exerciseExecutionSetIndex: setIndex,
      exerciseExecutionSet: set
    })
    this.store.set(updated)
    return updated
  }

  static async addExercise(exerciseId: string): Promise<WorkoutSession> {
    const current = this.requireSession()

    if (this.hasExercise(exerciseId)) {
      throw new Error('Exercise already exists in workout session')
    }

    const updated = await workoutSessionsStore.addExerciseToWorkoutSession({
      workoutSession: current,
      exerciseId
    })
    this.store.set(updated)
    return updated
  }

  static async deleteExercise(exerciseId: string): Promise<WorkoutSession> {
    const current = this.requireSession()
    const updated = await workoutSessionsStore.deleteExerciseFromWorkoutSession({
      workoutSession: current,
      exerciseId
    })
    this.store.set(updated)
    return updated
  }

  static async complete(): Promise<WorkoutSession> {
    const current = this.requireSession()
    const updated = await workoutSessionsStore.updateWorkoutSession({ ...current, status: 'completed' })
    this.store.set(updated)
    return updated
  }

  static async delete(): Promise<void> {
    const current = this.requireSession()
    await workoutSessionsStore.deleteWorkoutSession(current.id)
    this.store.set(undefined)
  }

  static isWorkoutComplete(exerciseDefinitions: Map<string, Exercise>): boolean {
    const session = this.store.get()
    if (!session) return false
    return session.exercises.every(({ exerciseId, sets }) => {
      const def = exerciseDefinitions.get(exerciseId)
      return def !== undefined && sets.length >= def.sets
    })
  }

  private static requireSession(): WorkoutSession {
    const session = this.store.get()
    if (!session) throw new Error('No active workout session')
    return session
  }
}

export default GymtimeSessionState
