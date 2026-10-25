import type { Program } from '../../db/stores/programsStore'
import { programsStore } from '../../db/stores/programsStore'
import ProgramComponent from './ProgramComponent'

class ProgramList {
  private programsGrid = document.querySelector('#programs-grid') as HTMLDivElement
  private onEdit: (program: Program) => void

  constructor(onEdit: (program: Program) => void, signal: AbortSignal) {
    this.onEdit = onEdit
    this.render(programsStore.all)

    const unsubscribe = programsStore.subscribe((programs) => this.render(programs))
    signal.addEventListener('abort', unsubscribe)
  }

  private render(programs: Array<Program>) {
    this.programsGrid.innerHTML = ''

    for (const program of programs) {
      const programComponent = new ProgramComponent(program, this.onEdit)
      const programItem = programComponent.render()
      this.programsGrid.appendChild(programItem)
    }
  }
}

export default ProgramList
