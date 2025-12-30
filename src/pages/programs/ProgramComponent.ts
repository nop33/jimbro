import { exercisesStore } from '../../db/stores/exercisesStore'
import type { Program } from '../../db/stores/programsStore'
import { nodeFromTemplate, setTextContent } from '../../utils'
import ExerciseComponent from '../exercises/ExerciseComponent'
import ProgramDialog from './ProgramDialog'

class ProgramComponent {
  private program: Program

  constructor(program: Program) {
    this.program = program
  }

  async render() {
    const programItem = nodeFromTemplate('#program-item-template')
    const editProgramBtn = programItem.querySelector('#edit-program-btn') as HTMLButtonElement
    const programExericesList = programItem.querySelector('#exercises-grid') as HTMLDivElement

    setTextContent('.program-name', this.program.name, programItem)

    for (const exerciseId of this.program.exercises) {
      const exercise = await exercisesStore.getExercise(exerciseId)

      if (exercise) {
        programExericesList.appendChild(new ExerciseComponent(exercise).render())
      }
    }

    editProgramBtn.addEventListener('click', () => {
      ProgramDialog.render(this.program)
      ProgramDialog.openDialog()
    })

    return programItem
  }
}

export default ProgramComponent
