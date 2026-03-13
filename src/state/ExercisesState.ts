import { db } from '../db'
import type { Exercise, NewExercise } from '../db/stores/exercisesStore'
import ReactiveStore from '../db/reactiveStore'

class ExercisesState {
  private static state = new ReactiveStore<Array<Exercise>>([])

  static get exercises(): Array<Exercise> {
    return this.state.get()
  }

  static getById(id: string): Exercise | undefined {
    return this.state.get().find((e) => e.id === id)
  }

  static subscribe(callback: (exercises: Array<Exercise>) => void): () => void {
    return this.state.subscribe(callback)
  }

  static async initialize(): Promise<void> {
    const allExercises = await db.exercises.getAll()
    this.state.set(allExercises)
  }

  static async createExercise(data: NewExercise): Promise<Exercise> {
    const exercise: Exercise = { ...data, id: crypto.randomUUID() }
    this.state.update((current) => [...current, exercise])

    try {
      await db.exercises.create(exercise)
    } catch (error) {
      this.state.update((current) => current.filter((e) => e.id !== exercise.id))
      throw error
    }

    return exercise
  }

  static async updateExercise(exercise: Exercise): Promise<Exercise> {
    if (exercise.isDeleted) {
      this.state.update((current) => current.filter((e) => e.id !== exercise.id))
    } else {
      this.state.update((current) => current.map((e) => (e.id === exercise.id ? exercise : e)))
    }

    try {
      await db.exercises.update(exercise)
    } catch (error) {
      await this.initialize()
      throw error
    }

    return exercise
  }

  static async softDeleteExercise(id: string): Promise<void> {
    const exercise = this.getById(id)

    if (!exercise) {
      throw new Error(`Exercise with id ${id} not found.`)
    }

    await this.updateExercise({ ...exercise, isDeleted: true })
  }
}

export default ExercisesState
