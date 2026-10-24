import { setFields } from '../../db/exerciseLogging'
import { workoutSessionsStore, type LastTime, type PlannedSession } from '../../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../../db/types'
import { formatShortDay, parseSimpleDate } from '../../dateUtils'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { configureSetRowGrid, renderSetFields } from './setSlots'

// Shows an exercise's sets in one earlier workout, opening on last time, with arrows to the workouts before and after
// it that logged the exercise, at any gym.
class LastSetDialog {
  private static dialog = document.getElementById('last-set-dialog') as HTMLDialogElement
  private static listContainer = document.getElementById('last-set-list') as HTMLDivElement
  private static dateEl = document.getElementById('last-set-date') as HTMLSpanElement
  private static gymEl = document.getElementById('last-set-gym') as HTMLSpanElement
  private static olderBtn = document.getElementById('last-set-older') as HTMLButtonElement
  private static newerBtn = document.getElementById('last-set-newer') as HTMLButtonElement
  private static closeBtn = this.dialog?.querySelector('.close-dialog-btn') as HTMLButtonElement

  // The workouts to step through, newest first, and the one shown.
  private static times: Array<LastTime> = []
  private static index = 0
  // Counts the openings, so a list read for an earlier one never lands on a later one.
  private static opening = 0

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

    this.olderBtn.addEventListener('click', () => this.step(1))
    this.newerBtn.addEventListener('click', () => this.step(-1))
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') this.step(1)
      if (event.key === 'ArrowRight') this.step(-1)
    })
  }

  static openDialog(
    exerciseId: string,
    lastTime: LastTime,
    before: PlannedSession & { id?: WorkoutSession['id'] }
  ): void {
    if (!this.dialog || !this.listContainer) return

    const opening = ++this.opening
    this.times = [lastTime]
    this.index = 0
    this.show()

    if (this.dialog.open) {
      this.closeDialog()
    }

    this.dialog.showModal()

    // Last time shows at once, and the arrows wake up once the other workouts are read.
    workoutSessionsStore.earlierTimesOf(exerciseId, before).then(
      (times) => {
        const index = times.findIndex(({ id }) => id === lastTime.id)
        if (opening !== this.opening || index === -1) return
        this.times = times
        this.index = index
        this.showArrows()
      },
      (error: unknown) => console.error('Could not read the earlier workouts', error)
    )
  }

  static closeDialog() {
    this.dialog.close()
  }

  // Moves by one workout, older for 1 and newer for -1.
  private static step(by: 1 | -1) {
    const index = this.index + by
    if (index < 0 || index >= this.times.length) return
    this.index = index
    this.show()
    // The sets come in from the side the workout lies on.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.listContainer.animate(
        [
          { opacity: 0, translate: `${by * -16}px 0` },
          { opacity: 1, translate: '0 0' }
        ],
        {
          duration: 200,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)'
        }
      )
    }
  }

  private static show() {
    const { date, location, sets } = this.times[this.index]
    this.dateEl.textContent = formatShortDay(parseSimpleDate(date))
    this.gymEl.textContent = location ? `in ${location}` : ''
    this.showArrows()

    this.listContainer.innerHTML = ''
    if (sets.length > 0) {
      configureSetRowGrid(this.listContainer, sets[0].preset)
    }

    sets.forEach((set, index) => {
      if (setFields(set).every(({ text }) => text === '-')) return

      const template = nodeFromTemplate('#completed-set-item-template')
      setTextContent('.set-number', (index + 1).toString(), template)
      renderSetFields(template.querySelector('.set-fields') as HTMLDivElement, set)
      ;(template.querySelector('.set') as HTMLDivElement).classList.add('isCompleted')
      this.listContainer.appendChild(template)
    })

    if (this.listContainer.children.length === 0) {
      const p = document.createElement('p')
      p.className = 'text-center text-jim-neutral-secondary py-4'
      p.textContent = 'No completed sets found in this workout.'
      this.listContainer.appendChild(p)
    }
  }

  // Each arrow names the day it goes to, and is off at the end of the list.
  private static showArrows() {
    const older = this.times[this.index + 1]
    const newer = this.times[this.index - 1]
    // An arrow that reaches the end hands focus to the other one, so the keyboard stays in the dialog. Disabling it
    // can drop its focus at once, so whether it had focus is read first.
    const focused = document.activeElement
    this.olderBtn.disabled = !older
    this.newerBtn.disabled = !newer
    if (!older && focused === this.olderBtn) this.newerBtn.focus()
    if (!newer && focused === this.newerBtn) this.olderBtn.focus()
    this.olderBtn.setAttribute('aria-label', older ? `Older workout, ${this.dayOf(older)}` : 'Older workout')
    this.newerBtn.setAttribute('aria-label', newer ? `Newer workout, ${this.dayOf(newer)}` : 'Newer workout')
  }

  private static dayOf({ date, location }: LastTime): string {
    const day = formatShortDay(parseSimpleDate(date))
    return location ? `${day} in ${location}` : day
  }
}

export default LastSetDialog
