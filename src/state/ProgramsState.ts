import { db } from '../db'
import type { NewProgram, Program } from '../db/stores/programsStore'
import ReactiveStore from '../db/reactiveStore'

class ProgramsState {
  private static state = new ReactiveStore<Array<Program>>([])

  static get programs(): Array<Program> {
    return this.state.get()
  }

  static subscribe(callback: (programs: Array<Program>) => void): () => void {
    return this.state.subscribe(callback)
  }

  static async initialize(): Promise<void> {
    const allPrograms = await db.programs.getAll()
    this.state.set(allPrograms)
  }

  static async createProgram(data: NewProgram): Promise<Program> {
    const program: Program = {
      ...data,
      exercises: this.getUniqueExercises(data.exercises),
      id: crypto.randomUUID()
    }

    this.state.update((current) => [...current, program])

    try {
      await db.programs.create(program)
    } catch (error) {
      this.state.update((current) => current.filter((p) => p.id !== program.id))
      throw error
    }

    return program
  }

  static async updateProgram(program: Program): Promise<Program> {
    const updatedProgram = {
      ...program,
      exercises: this.getUniqueExercises(program.exercises)
    }

    if (updatedProgram.isDeleted) {
      this.state.update((current) => current.filter((p) => p.id !== updatedProgram.id))
    } else {
      this.state.update((current) => current.map((p) => (p.id === updatedProgram.id ? updatedProgram : p)))
    }

    try {
      await db.programs.update(updatedProgram)
    } catch (error) {
      await this.initialize()
      throw error
    }

    return updatedProgram
  }

  private static getUniqueExercises(exercises: string[]): string[] {
    return Array.from(new Set(exercises))
  }

  static async softDeleteProgram(id: string): Promise<void> {
    const program = this.state.get().find((p) => p.id === id)

    if (!program) {
      throw new Error(`Program with id ${id} not found.`)
    }

    await this.updateProgram({ ...program, isDeleted: true })
  }
}

export default ProgramsState
