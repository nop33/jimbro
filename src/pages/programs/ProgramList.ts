import type { Program } from '../../db/stores/programsStore'
import { programs } from '../../db/stores/programsStore'
import ProgramComponent from './ProgramComponent'

class ProgramList {
  private static programsGrid = document.querySelector('#programs-grid') as HTMLDivElement

  static init() {
    this.render(programs.programs)

    programs.subscribe((programsList) => this.render(programsList))
  }

  static render(programsList: Array<Program>) {
    this.programsGrid.innerHTML = ''

    for (const program of programsList) {
      const programComponent = new ProgramComponent(program)
      const programItem = programComponent.render()
      this.programsGrid.appendChild(programItem)
    }
  }
}

export default ProgramList
