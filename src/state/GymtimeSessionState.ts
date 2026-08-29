import { db } from '../db'
import ReactiveStore from '../db/reactiveStore'
import {
  placeholderSnapshot,
  snapshotFromExercise,
  workoutSessionsStore,
  type ExerciseExecution,
  type ExerciseSetExecution,
  type NewWorkoutSession,
  type PersistedWorkoutSessionStatus,
  type WorkoutSession
} from '../db/stores/workoutSessionsStore'

export function computeWorkoutSessionStatus(session: Pick<WorkoutSession, 'exercises'>): PersistedWorkoutSessionStatus {
  if (session.exercises.length === 0) return 'incomplete'
  const allDone = session.exercises.every(({ sets, targetSets }) => sets.length >= targetSets)
  return allDone ? 'completed' : 'incomplete'
}

const executionFromCatalog = async (exerciseId: string): Promise<ExerciseExecution> => {
  const exercise = await db.exercises.getById(exerciseId)
  if (!exercise) {
    return { ...placeholderSnapshot(exerciseId), sets: [] }
  }
  return { ...snapshotFromExercise(exercise), sets: [] }
}

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
    const mutated = await workoutSessionsStore.updateWorkoutSession({ ...current, ...updates })
    const reconciled = await this.reconcileStatus(mutated)
    this.store.set(reconciled)
    return reconciled
  }

  static async moveExercise(exerciseId: string, direction: 'up' | 'down'): Promise<WorkoutSession> {
    const current = this.requireSession()
    const updated = await workoutSessionsStore.moveExerciseInWorkoutSession({
      workoutSession: current,
      exerciseId,
      direction
    })
    this.store.set(updated)
    return updated
  }

  static hasExercise(exerciseId: string, options: { showAlert?: boolean } = {}): boolean {
    const session = this.store.get()
    if (!session) return false

    const exists = session.exercises.some((e) => e.exerciseId === exerciseId)
    if (exists && options.showAlert) {
      alert('This exercise is already in your session.')
    }

    return exists
  }

  static async swapExercise(oldExerciseId: string, newExerciseId: string): Promise<WorkoutSession> {
    const current = this.requireSession()

    if (this.hasExercise(newExerciseId)) {
      throw new Error('Exercise already exists in workout session')
    }

    const mutated = await workoutSessionsStore.swapExerciseInWorkoutSession({
      workoutSession: current,
      oldExerciseId,
      replacement: await executionFromCatalog(newExerciseId)
    })
    const reconciled = await this.reconcileStatus(mutated)
    this.store.set(reconciled)
    return reconciled
  }

  static async addSet(exerciseId: string, set: ExerciseSetExecution): Promise<WorkoutSession> {
    const current = this.requireSession()
    const mutated = await workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
      workoutSession: current,
      exerciseId,
      exerciseExecutionSet: set
    })
    const reconciled = await this.reconcileStatus(mutated)
    this.store.set(reconciled)
    return reconciled
  }

  static async updateSet(exerciseId: string, setIndex: number, set: ExerciseSetExecution): Promise<WorkoutSession> {
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

    const mutated = await workoutSessionsStore.addExerciseToWorkoutSession({
      workoutSession: current,
      exercise: await executionFromCatalog(exerciseId)
    })
    const reconciled = await this.reconcileStatus(mutated)
    this.store.set(reconciled)
    return reconciled
  }

  static async deleteExercise(exerciseId: string): Promise<WorkoutSession> {
    const current = this.requireSession()
    const mutated = await workoutSessionsStore.deleteExerciseFromWorkoutSession({
      workoutSession: current,
      exerciseId
    })
    const reconciled = await this.reconcileStatus(mutated)
    this.store.set(reconciled)
    return reconciled
  }

  static async delete(): Promise<void> {
    const current = this.requireSession()
    await workoutSessionsStore.deleteWorkoutSession(current.id)
    this.store.set(undefined)
  }

  private static async reconcileStatus(session: WorkoutSession): Promise<WorkoutSession> {
    const expected = computeWorkoutSessionStatus(session)
    if (session.status === expected) return session
    return workoutSessionsStore.updateWorkoutSession({ ...session, status: expected })
  }

  private static requireSession(): WorkoutSession {
    const session = this.store.get()
    if (!session) throw new Error('No active workout session')
    return session
  }
}

export default GymtimeSessionState
