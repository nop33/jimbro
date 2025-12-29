import { programsStore, type Program } from "../../db/stores/programsStore"
import ProgramComponent from "./ProgramComponent"

class ProgramList {
  private static programsGrid = document.querySelector('#programs-grid') as HTMLDivElement

  static async init() {
    programsStore.subscribe((programs) => this.render(programs))
    this.render(programsStore.get())
  }

  static async render(programs: Array<Program>) {
    this.programsGrid.innerHTML = ''

    for (const program of programs) {
      const programComponent = new ProgramComponent(program)
      const programItem = await programComponent.render()
      this.programsGrid.appendChild(programItem)
    }
  }
}

export default ProgramList
