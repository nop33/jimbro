import { BaseStore } from '../baseStore'
import { OBJECT_STORES } from '../constants'

export interface Exercise {
  id: string
  name: string
  muscle: MuscleGroup
  sets: number
  reps: number
  isDeleted?: boolean
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

export class ExercisesStore extends BaseStore<Exercise> {
  protected readonly storeName = OBJECT_STORES.EXERCISES

  async getAll(): Promise<Array<Exercise>> {
    const all = await super.getAll()
    return all.filter((exercise) => !exercise.isDeleted)
  }

  async seed(): Promise<void> {
    const { default: seedExercises } = await import('./seed-exercises.json', { assert: { type: 'json' } })
    for (const exercise of seedExercises.exercises) {
      await this.create(exercise as Exercise)
    }
  }

  async softDelete(id: string): Promise<void> {
    const exercise = await this.getById(id)

    if (exercise) {
      await this.update({ ...exercise, isDeleted: true })
    } else {
      throw new Error(`Exercise with id ${id} not found.`)
    }
  }
}

export const exercisesStore = new ExercisesStore()
