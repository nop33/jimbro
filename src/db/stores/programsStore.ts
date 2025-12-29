import { OBJECT_STORES } from "../constants";
import { storage } from "../storage"
import type { Exercise } from "./exercisesStore";

export interface Program {
  id: string;
  name: string;
  exercises: Array<Exercise['id']>;
}

export type NewProgram = Omit<Program, 'id'>

export class ProgramsStore {
  private storeName = OBJECT_STORES.PROGRAMS

  async createProgram(item: NewProgram): Promise<Program> {
    const id = crypto.randomUUID();
    return storage.create(this.storeName, {...item, id})
  }

  async updateProgram(item: Program): Promise<Program> {
    return storage.update(this.storeName, item)
  }

  async getAllPrograms(): Promise<Array<Program>> {
    return storage.getAll(this.storeName)
  }

  async countPrograms(): Promise<number> {
    return storage.count(this.storeName)
  }
}

export const programsStore = new ProgramsStore()
