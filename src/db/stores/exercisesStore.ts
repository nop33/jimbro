import type { ExerciseRow } from '../../sync/rows'
import { BaseStore } from '../baseStore'
import { OBJECT_STORES } from '../constants'
import { nowIso } from '../nowIso'
import { upgradeExerciseRecord } from '../schemaUpgrade'

export { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, muscleGroupLabel } from '../muscleGroups'

export type Exercise = ExerciseRow

export type NewExercise = Omit<Exercise, 'id' | 'updatedAt'>

const normalizeExercise = (item: Exercise): Exercise =>
  upgradeExerciseRecord(item as unknown as Record<string, unknown>, nowIso())

export class ExercisesStore extends BaseStore<Exercise> {
  protected readonly storeName = OBJECT_STORES.EXERCISES

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

  async seed(): Promise<void> {
    const { default: seedExercises } = await import('./seed-exercises.json')
    const now = nowIso()
    for (const exercise of seedExercises.exercises) {
      await this.create(upgradeExerciseRecord(exercise as Record<string, unknown>, now))
    }
  }
}

export const exercisesStore = new ExercisesStore()
