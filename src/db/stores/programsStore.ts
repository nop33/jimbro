import { CatalogStore } from '../catalogStore'
import { nowIso } from '../nowIso'
import { upgradeProgramRecord } from '../schemaUpgrade'
import type { ProgramRow } from '../types'

export type Program = ProgramRow

class ProgramsStore extends CatalogStore<'programs'> {
  protected readonly table = 'programs'

  protected normalize(program: Program): Program {
    return upgradeProgramRecord(program as unknown as Record<string, unknown>, nowIso())
  }

  async seed(): Promise<void> {
    const { default: seedPrograms } = await import('./seed-programs.json')
    const now = nowIso()
    await this.write(seedPrograms.programs.map((program) => upgradeProgramRecord(program, now)))
  }
}

export const programsStore = new ProgramsStore()
