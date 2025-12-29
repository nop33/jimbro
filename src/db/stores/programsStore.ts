import { OBJECT_STORES } from "../constants";
import ReactiveStore from "../reactiveStore";
import { storage } from "../storage"
import type { Exercise } from "./exercisesStore";

export interface Program {
  id: string;
  name: string;
  exercises: Array<Exercise['id']>;
}

export type NewProgram = Omit<Program, 'id'>

export class ProgramsReactiveStore extends ReactiveStore<Array<Program>> {
  private storeName = OBJECT_STORES.PROGRAMS

  async initialize() {
    const allPrograms = await this.getAllPrograms()
    this.set(allPrograms)
  }

  async createProgram(item: NewProgram): Promise<Program> {
    const newProgram: Program = { ...item, id: crypto.randomUUID() }

    this.update((currentPrograms) => [...currentPrograms, newProgram]) // optimistic update

    try {
      await storage.create(this.storeName, newProgram)
    } catch (error) {
      this.update((currentPrograms) => {
        return currentPrograms.filter((program) => program.id !== newProgram.id) // rollback optimistic update
      })
      throw error
    }

    return newProgram
  }

  async updateProgram(item: Program): Promise<Program> {
    this.update((currentPrograms) => {
      return currentPrograms.map((program) => program.id === item.id ? item : program)
    })

    try {
      await storage.update(this.storeName, item)
    } catch (error) {
      await this.getAllPrograms()
      throw error
    }

    return item
  }

  async getAllPrograms(): Promise<Array<Program>> {
    return storage.getAll<Program>(this.storeName)
  }

  async countPrograms(): Promise<number> {
    return storage.count(this.storeName)
  }
}

export const programsStore = new ProgramsReactiveStore([])
