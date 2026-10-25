import type { Program } from '../../db/stores/programsStore'
import { exercisesStore } from '../../db/stores/exercisesStore'
import { nodeFromTemplate, setTextContent } from '../../utils'
import ExerciseComponent from '../exercises/ExerciseComponent'

class ProgramComponent {
  private program: Program
  private onEdit: (program: Program) => void

  constructor(program: Program, onEdit: (program: Program) => void) {
    this.program = program
    this.onEdit = onEdit
  }

  render() {
    const programItem = nodeFromTemplate('#program-item-template')
    const editProgramBtn = programItem.querySelector('.edit-program-btn') as HTMLButtonElement
    const programExericesList = programItem.querySelector('.exercises-grid') as HTMLDivElement

    setTextContent('.program-name', this.program.name, programItem)

    for (const exerciseId of this.program.exercises) {
      const exercise = exercisesStore.find(exerciseId)

      if (exercise) {
        programExericesList.appendChild(new ExerciseComponent(exercise).render())
      }
    }

    editProgramBtn.addEventListener('click', () => this.onEdit(this.program))

    return programItem
  }
}

export default ProgramComponent
