import { setFields, type ExerciseSetExecution } from '../../db/exerciseLogging'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { configureSetRowGrid, renderSetFields } from './setSlots'

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

    if (sets.length > 0) {
      configureSetRowGrid(this.listContainer, sets[0].preset)
    }

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
      if (setFields(set).every(({ text }) => text === '-')) return

      const template = nodeFromTemplate('#completed-set-item-template')

      setTextContent('.set-number', (index + 1).toString(), template)
      renderSetFields(template.querySelector('.set-fields') as HTMLDivElement, set)

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
