import type { Program } from '../../db/stores/programsStore'
import ProgramsState from '../../state/ProgramsState'
import ProgramComponent from './ProgramComponent'

class ProgramList {
  private static programsGrid = document.querySelector('#programs-grid') as HTMLDivElement

  static init() {
    this.render(ProgramsState.programs)

    ProgramsState.subscribe((programs) => this.render(programs))
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
