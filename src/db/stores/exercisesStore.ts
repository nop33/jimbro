import { OBJECT_STORES } from "../constants";
import { storage } from "../storage"

export interface Exercise {
  id: string;
  name: string;
  muscle: MuscleGroup;
  sets: number;
  reps: number;
}

export type NewExercise = Omit<Exercise, 'id'>

export const MUSCLE_GROUPS = [
  'Quads',
  'Calves',
  'Hamstrings',
  'Core',
  'Chest',
  'Triceps',
  'Shoulders',
  'Back',
  'Biceps',
  'Traps',
] as const;

export type MuscleGroup = typeof MUSCLE_GROUPS[number]

export class ExercisesStore {
  private storeName = OBJECT_STORES.EXERSISES

  async createExercise(item: NewExercise): Promise<Exercise> {
    const id = crypto.randomUUID();
    return storage.create(this.storeName, {...item, id})
  }

  async updateExercise(item: Exercise): Promise<Exercise> {
    return storage.update(this.storeName, item)
  }

  async getAllExercises(): Promise<Array<Exercise>> {
    return storage.getAll(this.storeName)
  }

  async countExercises(): Promise<number> {
    return storage.count(this.storeName)
  }
}

export const exercisesStore = new ExercisesStore()
