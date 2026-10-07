import { CatalogStore, type NewCatalogRow } from '../catalogStore'
import { nowIso } from '../nowIso'
import { upgradeExerciseRecord } from '../schemaUpgrade'
import type { ExerciseRow } from '../types'

export type Exercise = ExerciseRow

export type NewExercise = NewCatalogRow<'exercises'>

class ExercisesStore extends CatalogStore<'exercises'> {
  protected readonly table = 'exercises'

  protected normalize(exercise: Exercise): Exercise {
    return upgradeExerciseRecord(exercise as unknown as Record<string, unknown>, nowIso())
  }

  protected sort(exercises: Array<Exercise>): Array<Exercise> {
    return exercises.sort((a, b) => a.name.localeCompare(b.name))
  }

  async seed(): Promise<void> {
    const { default: seedExercises } = await import('./seed-exercises.json')
    const now = nowIso()
    await this.write(seedExercises.exercises.map((exercise) => upgradeExerciseRecord(exercise, now)))
  }
}

export const exercisesStore = new ExercisesStore()
