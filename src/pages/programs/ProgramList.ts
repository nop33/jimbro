import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { exerciseGroupLabel, programPageUrl, programTotals } from './programExercises'

// One card per program, each a link to the program's page, with its totals and the muscle groups it works.
class ProgramList {
  private programsGrid = document.querySelector('#programs-grid') as HTMLUListElement

  constructor(signal: AbortSignal) {
    this.render(programsStore.all)
    const unsubscribe = programsStore.subscribe((programs) => this.render(programs))
    signal.addEventListener('abort', unsubscribe)
  }

  private render(programs: Array<Program>) {
    this.programsGrid.replaceChildren(...programs.map((program) => this.card(program)))
  }

  private card(program: Program) {
    const item = nodeFromTemplate('#program-item-template')
    const exercises = program.exercises
      .map((id) => exercisesStore.find(id))
      .filter((exercise): exercise is Exercise => exercise !== undefined)
    ;(item.querySelector('a') as HTMLAnchorElement).href = programPageUrl(program.id)
    setTextContent('.program-name', program.name, item)
    setTextContent('.program-summary', programTotals(exercises), item)
    const groups = [...new Set(exercises.map(exerciseGroupLabel))]
    ;(item.querySelector('.program-muscles') as HTMLElement).append(
      ...groups.map((group) => {
        const chip = document.createElement('span')
        chip.textContent = group
        return chip
      })
    )
    return item
  }
}

export default ProgramList
