import type { ExerciseRow } from '../types'
import { BaseStore } from '../baseStore'
import { OBJECT_STORES } from '../constants'
import { nowIso } from '../nowIso'
import { upgradeExerciseRecord } from '../schemaUpgrade'
import ReactiveStore from '../reactiveStore'

export type Exercise = ExerciseRow

export type NewExercise = Omit<Exercise, 'id' | 'updatedAt'>

const normalizeExercise = (item: Exercise): Exercise =>
  upgradeExerciseRecord(item as unknown as Record<string, unknown>, nowIso())

class ExercisesStore extends BaseStore<Exercise> {
  protected readonly storeName = OBJECT_STORES.EXERCISES
  private state = new ReactiveStore<Array<Exercise>>([])

  get exercises(): Array<Exercise> {
    return this.state.get()
  }

  findById(id: string): Exercise | undefined {
    return this.state.get().find((e) => e.id === id)
  }

  subscribe(callback: (exercises: Array<Exercise>) => void): () => void {
    return this.state.subscribe(callback)
  }

  async initialize(): Promise<void> {
    const allExercises = await this.getAll()
    this.state.set(allExercises)
  }

  async getAll(): Promise<Array<Exercise>> {
    const all = await super.getAll()
    return all.filter((exercise) => !exercise.isDeleted).sort((a, b) => a.name.localeCompare(b.name))
  }

  async create(item: Exercise): Promise<void> {
    await super.create(normalizeExercise({ ...item, updatedAt: nowIso() }))
  }

  async update(item: Exercise): Promise<Exercise> {
    return super.update(normalizeExercise({ ...item, updatedAt: nowIso() }))
  }

  async createExercise(data: NewExercise): Promise<Exercise> {
    const exercise: Exercise = { ...data, id: crypto.randomUUID(), isDeleted: data.isDeleted ?? false, updatedAt: '' }
    this.state.update((current) => [...current, exercise])

    try {
      await this.create(exercise)
    } catch (error) {
      this.state.update((current) => current.filter((e) => e.id !== exercise.id))
      throw error
    }

    return exercise
  }

  async updateExercise(exercise: Exercise): Promise<Exercise> {
    if (exercise.isDeleted) {
      this.state.update((current) => current.filter((e) => e.id !== exercise.id))
    } else {
      this.state.update((current) => current.map((e) => (e.id === exercise.id ? exercise : e)))
    }

    try {
      await this.update(exercise)
    } catch (error) {
      await this.initialize()
      throw error
    }

    return exercise
  }

  async softDeleteExercise(id: string): Promise<void> {
    const exercise = this.findById(id)

    if (!exercise) {
      throw new Error(`Exercise with id ${id} not found.`)
    }

    await this.updateExercise({ ...exercise, isDeleted: true })
  }

  async seed(): Promise<void> {
    const { default: seedExercises } = await import('./seed-exercises.json')
    const now = nowIso()
    for (const exercise of seedExercises.exercises) {
      await this.create(upgradeExerciseRecord(exercise as Record<string, unknown>, now))
    }
  }
}

export const exercises = new ExercisesStore()
