import { daysAgo, getWeekOfYear, parseSimpleDate } from '../../dateUtils'
import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../../db/types'
import { nodeFromTemplate, setTextContent } from '../../utils'

class NewWorkoutDialog {
  private static newWorkoutDialog = document.querySelector('#new-workout-dialog') as HTMLDialogElement
  private static programsList = document.querySelector('#programs-list') as HTMLUListElement
  private static newWorkoutButton = document.querySelector('#new-workout-btn') as HTMLButtonElement
  private static dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement

  static init(workoutSessionsByWeek: Record<string, Array<WorkoutSession>>) {
    this.newWorkoutButton.addEventListener('click', () => {
      this.openDialog()
    })

    this.dialogCancel.addEventListener('click', () => {
      this.closeDialog()
    })

    this.newWorkoutDialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => {
      this.closeDialog()
    })

    // The page doesn't wait for the program list. A tap on New before it fills shows the programs read so far.
    void this.render(workoutSessionsByWeek)
  }

  private static async render(workoutSessionsByWeek: Record<string, Array<WorkoutSession>>) {
    const programs = await programsStore.load()
    const thisWeekWorkoutSessions = workoutSessionsByWeek[getWeekOfYear(new Date())] ?? []

    for (const program of programs) {
      const lastCompletedWorkoutSession = await workoutSessionsStore.getLatestCompletedOfProgram(program.id)
      const programItem = nodeFromTemplate('#program-item-template')
      const programItemDiv = programItem.querySelector('div') as HTMLDivElement
      const programLink = programItem.querySelector('.program-link') as HTMLAnchorElement
      const lastCompletedDate = lastCompletedWorkoutSession?.date
        ? parseSimpleDate(lastCompletedWorkoutSession.date).toLocaleDateString()
        : 'Never'
      const daysAgoText = lastCompletedWorkoutSession?.date
        ? daysAgo(parseSimpleDate(lastCompletedWorkoutSession.date))
        : 0

      setTextContent('.program-name', program.name, programItem)

      const isProgramInThisWeek = thisWeekWorkoutSessions.find(
        (workoutSession) => workoutSession.programId === program.id
      )
      if (isProgramInThisWeek) {
        if (isProgramInThisWeek.status === 'completed') {
          programItemDiv.classList.add('card-success')
          setTextContent('.this-week-status', 'You have already completed this program for this week!', programItem)
        } else if (isProgramInThisWeek.status === 'incomplete') {
          programItemDiv.classList.add('card-warning')
          setTextContent(
            '.this-week-status',
            'You have an incomplete workout session for this program this week.',
            programItem
          )
        }
      }

      if (lastCompletedDate) {
        setTextContent(
          '.last-completed-date',
          `Latest completed ${daysAgoText} days ago (on: ${lastCompletedDate})`,
          programItem
        )
      }
      programLink.href = `/gymtime/?programId=${program.id}`
      this.programsList.appendChild(programItem)
    }
  }

  private static openDialog() {
    this.newWorkoutDialog.showModal()
  }

  private static closeDialog() {
    this.newWorkoutDialog.close()
  }
}

export default NewWorkoutDialog
