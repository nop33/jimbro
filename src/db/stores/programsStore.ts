import type { ProgramRow } from '../types'
import { BaseStore } from '../baseStore'
import { OBJECT_STORES } from '../constants'
import { nowIso } from '../nowIso'
import ReactiveStore from '../reactiveStore'

export type Program = ProgramRow

export type NewProgram = Omit<Program, 'id' | 'updatedAt'>

const normalizeProgram = (item: Program): Program => ({
  ...item,
  isDeleted: Boolean(item.isDeleted),
  updatedAt: item.updatedAt || nowIso()
})

class ProgramsStore extends BaseStore<Program> {
  protected readonly storeName = OBJECT_STORES.PROGRAMS
  private state = new ReactiveStore<Array<Program>>([])

  get programs(): Array<Program> {
    return this.state.get()
  }

  findById(id: string): Program | undefined {
    return this.state.get().find((p) => p.id === id)
  }

  subscribe(callback: (programs: Array<Program>) => void): () => void {
    return this.state.subscribe(callback)
  }

  async initialize(): Promise<void> {
    const allPrograms = await this.getAll()
    this.state.set(allPrograms)
  }

  async getAll(): Promise<Array<Program>> {
    const all = await super.getAll()
    return all.filter((program) => !program.isDeleted)
  }

  async create(item: Program): Promise<void> {
    await super.create(normalizeProgram({ ...item, updatedAt: nowIso() }))
  }

  async update(item: Program): Promise<Program> {
    return super.update(normalizeProgram({ ...item, updatedAt: nowIso() }))
  }

  async createProgram(data: NewProgram): Promise<Program> {
    const program: Program = { ...data, id: crypto.randomUUID(), isDeleted: data.isDeleted ?? false, updatedAt: '' }
    this.state.update((current) => [...current, program])

    try {
      await this.create(program)
    } catch (error) {
      this.state.update((current) => current.filter((p) => p.id !== program.id))
      throw error
    }

    return program
  }

  async updateProgram(program: Program): Promise<Program> {
    if (program.isDeleted) {
      this.state.update((current) => current.filter((p) => p.id !== program.id))
    } else {
      this.state.update((current) => current.map((p) => (p.id === program.id ? program : p)))
    }

    try {
      await this.update(program)
    } catch (error) {
      await this.initialize()
      throw error
    }

    return program
  }

  async softDeleteProgram(id: string): Promise<void> {
    const program = this.findById(id)

    if (!program) {
      throw new Error(`Program with id ${id} not found.`)
    }

    await this.updateProgram({ ...program, isDeleted: true })
  }

  async getNameMap(): Promise<Record<string, string>> {
    const programs = await this.getAll()
    return programs.reduce(
      (acc, program) => {
        acc[program.id] = program.name
        return acc
      },
      {} as Record<string, string>
    )
  }

  async seed(): Promise<void> {
    const { default: seedPrograms } = await import('./seed-programs.json')
    for (const program of seedPrograms.programs) {
      await this.create(program as Program)
    }
  }
}

export const programs = new ProgramsStore()
