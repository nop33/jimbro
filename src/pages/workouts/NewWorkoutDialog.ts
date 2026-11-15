import { formatShortDate, parseSimpleDate } from '../../dateUtils'
import { nodeFromTemplate, setTextContent } from '../../utils'
import type { ProgramStatus } from '../../weeks'
import { pullDownToClose } from '../../features/bottomSheet'

const lastCompletedText = (lastCompleted: ProgramStatus['lastCompleted']) => {
  if (!lastCompleted) return 'Not completed yet'
  const { date, daysAgo } = lastCompleted
  const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
  return `Latest completed ${when} (on: ${formatShortDate(parseSimpleDate(date))})`
}

class NewWorkoutDialog {
  private newWorkoutDialog = document.querySelector('#new-workout-dialog') as HTMLDialogElement
  private programsList = document.querySelector('#programs-list') as HTMLUListElement
  private newWorkoutButton = document.querySelector('#new-workout-btn') as HTMLButtonElement

  constructor(programs: Array<ProgramStatus>) {
    pullDownToClose(this.newWorkoutDialog)
    this.newWorkoutButton.addEventListener('click', () => {
      this.open()
    })

    this.newWorkoutDialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => {
      this.closeDialog()
    })

    this.render(programs)
  }

  private render(programs: Array<ProgramStatus>) {
    for (const { program, thisWeek, ahead, lastCompleted } of programs) {
      const programItem = nodeFromTemplate('#program-item-template')
      const programItemDiv = programItem.querySelector('div') as HTMLDivElement
      const programLink = programItem.querySelector('.program-link') as HTMLAnchorElement

      setTextContent('.program-name', program.name, programItem)

      if (thisWeek?.status === 'completed') {
        programItemDiv.classList.add('card-success')
        setTextContent('.this-week-status', 'You have already completed this program for this week!', programItem)
      } else if (ahead) {
        programItemDiv.classList.add('card-success')
        setTextContent(
          '.this-week-status',
          'You did this program ahead last week, so it counts for this week.',
          programItem
        )
      } else if (thisWeek?.status === 'incomplete') {
        programItemDiv.classList.add('card-warning')
        setTextContent(
          '.this-week-status',
          'You have an incomplete workout session for this program this week.',
          programItem
        )
      }

      setTextContent('.last-completed-date', lastCompletedText(lastCompleted), programItem)
      programLink.href = `/gymtime/?programId=${program.id}`
      this.programsList.appendChild(programItem)
    }
  }

  open() {
    this.newWorkoutDialog.showModal()
  }

  private closeDialog() {
    this.newWorkoutDialog.close()
  }
}

export default NewWorkoutDialog
