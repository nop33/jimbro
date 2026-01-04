import { OBJECT_STORES } from '../constants'
import ReactiveStore from '../reactiveStore'
import { storage } from '../storage'
import seedExercises from './seed-exercises.json' assert { type: 'json' }

export interface Exercise {
  id: string
  name: string
  muscle: MuscleGroup
  sets: number
  reps: number
}

export type NewExercise = Omit<Exercise, 'id'>

export const MUSCLE_GROUPS = [
  'Quads',
  'Calves',
  'Hamstrings',
  'Glutes',
  'Chest',
  'Biceps',
  'Triceps',
  'Shoulders',
  'Traps',
  'Back',
  'Core'
] as const

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

export class ExercisesReactiveStore extends ReactiveStore<Array<Exercise>> {
  private storeName = OBJECT_STORES.EXERSISES

  async initialize() {
    const allExercises = await this.getAllExercises()
    this.set(allExercises)
  }

  async createExercise(item: NewExercise): Promise<Exercise> {
    const newExercise: Exercise = { ...item, id: crypto.randomUUID() }
    await this.importExercise(newExercise)
    return newExercise
  }

  async importExercise(exercise: Exercise): Promise<void> {
    this.update((currentExercises) => [...currentExercises, exercise]) // optimistic update

    try {
      await storage.create(this.storeName, exercise)
    } catch (error) {
      this.update((currentExercises) => {
        return currentExercises.filter((exercise) => exercise.id !== exercise.id) // rollback optimistic update
      })
      throw error
    }
  }

  async getExercise(id: string): Promise<Exercise | undefined> {
    return storage.get(this.storeName, id)
  }

  async updateExercise(item: Exercise): Promise<Exercise> {
    this.update((currentExercises) => currentExercises.map((exercise) => (exercise.id === item.id ? item : exercise)))

    try {
      await storage.update(this.storeName, item)
    } catch (error) {
      await this.getAllExercises()
      throw error
    }

    return item
  }

  async getAllExercises(): Promise<Array<Exercise>> {
    return storage.getAll<Exercise>(this.storeName)
  }

  async countExercises(): Promise<number> {
    return storage.count(this.storeName)
  }

  async seedExercises(): Promise<void> {
    for (const exercise of seedExercises.exercises) {
      await this.importExercise(exercise as Exercise)
    }
  }
}

export const exercisesStore = new ExercisesReactiveStore([])
