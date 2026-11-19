import { pullDownToClose } from '../../features/bottomSheet'
import { renderProgramPicks, type ProgramPick } from '../programPicks'

// The New sheet lists the programs as Home's "Pick your workout" does.
class NewWorkoutDialog {
  private newWorkoutDialog = document.querySelector('#new-workout-dialog') as HTMLDialogElement
  private newWorkoutButton = document.querySelector('#new-workout-btn') as HTMLButtonElement

  constructor(picks: Array<ProgramPick>) {
    pullDownToClose(this.newWorkoutDialog)
    this.newWorkoutButton.addEventListener('click', () => {
      this.open()
    })

    renderProgramPicks(this.newWorkoutDialog.querySelector('#program-picks') as HTMLUListElement, picks)
  }

  open() {
    this.newWorkoutDialog.showModal()
  }
}

export default NewWorkoutDialog
