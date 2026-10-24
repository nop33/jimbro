import type { Program } from '../../db/stores/programsStore'
import { programsStore } from '../../db/stores/programsStore'
import ProgramComponent from './ProgramComponent'

class ProgramList {
  private static get programsGrid() {
    return document.querySelector('#programs-grid') as HTMLDivElement
  }

  static init(signal: AbortSignal) {
    this.render(programsStore.all)

    const unsubscribe = programsStore.subscribe((programs) => this.render(programs))
    signal.addEventListener('abort', unsubscribe)
  }

  static render(programs: Array<Program>) {
    this.programsGrid.innerHTML = ''

    for (const program of programs) {
      const programComponent = new ProgramComponent(program)
      const programItem = programComponent.render()
      this.programsGrid.appendChild(programItem)
    }
  }
}

export default ProgramList
