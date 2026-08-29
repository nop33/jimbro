import { BaseStore } from '../baseStore'
import { OBJECT_STORES } from '../constants'
import { nowIso } from '../nowIso'
import type { Exercise } from './exercisesStore'

export interface Program {
  id: string
  name: string
  exercises: Array<Exercise['id']>
  isDeleted: boolean
  updatedAt: string
}

export type NewProgram = Omit<Program, 'id' | 'updatedAt'>

export const normalizeProgram = (item: Program): Program => ({
  ...item,
  isDeleted: Boolean(item.isDeleted),
  updatedAt: item.updatedAt || nowIso()
})

export class ProgramsStore extends BaseStore<Program> {
  protected readonly storeName = OBJECT_STORES.PROGRAMS

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

  async softDelete(id: string): Promise<void> {
    const program = await this.getById(id)

    if (program) {
      await this.update({ ...program, isDeleted: true })
    } else {
      throw new Error(`Program with id ${id} not found.`)
    }
  }
}

export const programsStore = new ProgramsStore()
