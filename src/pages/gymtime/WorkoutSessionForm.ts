import { formatShortDate, getSimpleDate, parseSimpleDate } from '../../dateUtils'
import { programsStore, type Program } from '../../db/stores/programsStore'
import { catalogSnapshots, workoutSessionsStore, type PlannedSession } from '../../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../../db/types'
import type { OpenSession } from './openSession'

// The workout's day, gym and notes, under a summary line that shows the day and gym. Before the workout starts they
// say what the start will store; after, each change saves as it is made.
class WorkoutSessionForm {
  private form = document.querySelector('#gymtime-form') as HTMLFormElement
  private dateInput = this.form.querySelector('input[name="date"]') as HTMLInputElement
  private locationInput = this.form.querySelector('input[name="location"]') as HTMLInputElement
  private clearGymBtn = this.form.querySelector('#clear-gym-btn') as HTMLButtonElement
  private gymOptions = this.form.querySelector('#gym-options') as HTMLDataListElement
  private notesInput = this.form.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  private dateLabel = document.querySelector('#workout-date-label') as HTMLSpanElement
  private gymLabel = document.querySelector('#workout-gym-label') as HTMLSpanElement
  private programId: Program['id']
  private openSession: OpenSession

  // The form starts a workout of the program, and saves each change to the workout once openSession holds one.
  constructor(openSession: OpenSession, programId: Program['id']) {
    this.openSession = openSession
    this.programId = programId
  }

  // session is the workout the page opened, if any.
  async init(session: WorkoutSession | undefined, { onPlanChanged }: { onPlanChanged: () => void }) {
    const today = getSimpleDate(new Date())

    this.dateInput.value = session?.date || today
    this.dateInput.max = today
    this.notesInput.value = session?.notes || ''

    if (session) {
      this.locationInput.value = session.location
    } else {
      const latestSaved = await workoutSessionsStore.getLatestSaved()
      if (latestSaved?.location) {
        this.locationInput.value = latestSaved.location
      }
    }
    this.showSummary()

    this.showGymOptions((await workoutSessionsStore.getGyms()).map(({ name }) => name))

    // Emptying the field shows every suggestion, and keeping the focus there keeps the keyboard and the
    // suggestions above it open.
    this.clearGymBtn.addEventListener('click', () => {
      this.locationInput.value = ''
      this.locationInput.focus()
    })

    // A change fires once the field is left or a value picked, so typing a gym name saves it once.
    this.form.addEventListener('change', async (event) => {
      this.showSummary()
      if (event.target !== this.notesInput) onPlanChanged()
      if (!this.openSession.current) return
      if (this.form.reportValidity()) await this.save()
    })
    // Enter in a field submits the form, which has nothing more to save.
    this.form.addEventListener('submit', (event) => event.preventDefault())
  }

  // The day and gym the form starts the workout with.
  planned(): PlannedSession {
    return { date: this.dateInput.value, location: this.locationInput.value }
  }

  // Creates the workout with the form's day, gym and notes and the program's exercises.
  async start(): Promise<WorkoutSession> {
    const program = await programsStore.getById(this.programId)
    if (!program) throw new Error('Program not found')

    const exercises = await catalogSnapshots(program.exercises)

    const { date, location } = this.planned()
    const notes = this.notesInput.value
    return workoutSessionsStore.create({ programId: this.programId, date, location, exercises, notes })
  }

  private async save() {
    const { date, location } = this.planned()
    const notes = this.notesInput.value
    await this.openSession.apply((session) => workoutSessionsStore.update(session, { date, location, notes }))
  }

  // "Today · Athens", or the day as "Oct 11" when it is another one.
  private showSummary() {
    const date = this.dateInput.value
    const today = new Date()
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    this.dateLabel.textContent =
      date === getSimpleDate(today)
        ? 'Today'
        : date === getSimpleDate(yesterday)
          ? 'Yesterday'
          : formatShortDate(parseSimpleDate(date), today)
    this.gymLabel.textContent = this.locationInput.value.trim() || 'No gym'
  }

  // The field's suggestions: a <datalist>, which Chrome shows as a dropdown and Safari above the keyboard.
  private showGymOptions(names: Array<string>) {
    this.gymOptions.replaceChildren(...names.map((name) => new Option(name)))
  }
}

export default WorkoutSessionForm
