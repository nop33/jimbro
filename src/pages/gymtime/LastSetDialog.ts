import type { ExerciseSetExecution } from '../../db/stores/workoutSessionsStore'
import { nodeFromTemplate, setTextContent } from '../../utils'

class LastSetDialog {
  private static dialog = document.getElementById('last-set-dialog') as HTMLDialogElement
  private static listContainer = document.getElementById('last-set-list') as HTMLDivElement
  private static subtitleEl = document.getElementById('last-set-subtitle') as HTMLParagraphElement
  private static closeBtn = this.dialog?.querySelector('.close-dialog-btn') as HTMLButtonElement

  static init() {
    if (!this.dialog) return

    this.closeBtn.addEventListener('click', () => {
      this.closeDialog()
    })

    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) {
        this.closeDialog()
      }
    })
  }

  static async openDialog(sets: ExerciseSetExecution[], date: string, location?: string) {
    if (!this.dialog || !this.listContainer) return

    this.listContainer.innerHTML = ''

    const { parseSimpleDate } = await import('../../dateUtils')
    const formattedDate = parseSimpleDate(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })

    if (this.subtitleEl) {
      if (location) {
        this.subtitleEl.textContent = `in ${location} on ${formattedDate}`
      } else {
        this.subtitleEl.textContent = `on ${formattedDate}`
      }
    }

    sets.forEach((set, index) => {
      if (set.reps === 0) return

      const template = nodeFromTemplate('#completed-set-item-template')
      const setNumber = (index + 1).toString()

      setTextContent('.set-reps', set.reps.toString(), template)
      setTextContent('.set-weight', set.weight.toString(), template)
      setTextContent('.set-number', setNumber, template)

      const div = template.querySelector('.set') as HTMLDivElement
      div.classList.add('isCompleted')

      this.listContainer.appendChild(template)
    })

    if (this.listContainer.children.length === 0) {
      const p = document.createElement('p')
      p.className = 'text-center text-jim-neutral-secondary py-4'
      p.textContent = 'No completed sets found in the last session.'
      this.listContainer.appendChild(p)
    }

    if (this.dialog.open) {
      this.closeDialog()
    }

    this.dialog.showModal()
  }

  static closeDialog() {
    this.dialog.close()
  }
}

export default LastSetDialog
