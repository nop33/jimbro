import { programsStore, type Program } from "../../db/stores/programsStore"
import ProgramComponent from "./ProgramComponent"

class ProgramList {
  private static programsGrid = document.querySelector('#programs-grid') as HTMLDivElement
  private static programs: Array<Program> = []

  static init() {
    this.reload()
  }

  private static reset() {
    this.programsGrid.innerHTML = ''
  }

  static async render(programs: Array<Program>) {
    this.reset()

    for (const program of programs) {
      const programComponent = new ProgramComponent(program)
      const programItem = await programComponent.render()
      this.programsGrid.appendChild(programItem)
    }
  }

  static async reload() {
    this.programs = await programsStore.getAllPrograms()
    this.render(this.programs)
  }
}

export default ProgramList
