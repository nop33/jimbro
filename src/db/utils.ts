import { OBJECT_STORES } from './constants'
import { storage } from './storage'

const hasExercises = async (): Promise<boolean> => {
  return (await storage.count(OBJECT_STORES.EXERCISES)) !== 0
}

const hasPrograms = async (): Promise<boolean> => {
  return (await storage.count(OBJECT_STORES.PROGRAMS)) !== 0
}

export const isDbEmpty = async (): Promise<boolean> => {
  return !(await hasExercises()) && !(await hasPrograms())
}
