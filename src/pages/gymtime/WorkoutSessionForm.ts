import { formatShortDate, getSimpleDate, parseSimpleDate } from '../../dateUtils'
import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import {
  placeholderSnapshot,
  snapshotFromExercise,
  workoutSessionsStore,
  type PlannedSession
} from '../../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../../db/types'
import { openSession } from './openSession'

// The workout's day, gym and notes, under a summary line that shows the day and gym. Before the workout starts they
// say what the start will store; after, each change saves as it is made.
class WorkoutSessionForm {
  private static form = document.querySelector('#gymtime-form') as HTMLFormElement
  private static dateInput = this.form.querySelector('input[name="date"]') as HTMLInputElement
  private static locationInput = this.form.querySelector('input[name="location"]') as HTMLInputElement
  private static clearGymBtn = this.form.querySelector('#clear-gym-btn') as HTMLButtonElement
  private static gymOptions = this.form.querySelector('#gym-options') as HTMLDataListElement
  private static notesInput = this.form.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  private static dateLabel = document.querySelector('#workout-date-label') as HTMLSpanElement
  private static gymLabel = document.querySelector('#workout-gym-label') as HTMLSpanElement
  private static programId: Program['id']

  // session is the workout the page opened, if any.
  static async init(
    programId: Program['id'],
    session: WorkoutSession | undefined,
    { onPlanChanged }: { onPlanChanged: () => void }
  ) {
    this.programId = programId

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
      if (!openSession.current) return
      if (this.form.reportValidity()) await this.save()
    })
    // Enter in a field submits the form, which has nothing more to save.
    this.form.addEventListener('submit', (event) => event.preventDefault())
  }

  // The day and gym the form starts the workout with.
  static planned(): PlannedSession {
    return { date: this.dateInput.value, location: this.locationInput.value }
  }

  // Creates the workout with the form's day, gym and notes and the program's exercises.
  static async start(): Promise<WorkoutSession> {
    const program = await programsStore.getById(this.programId)
    if (!program) throw new Error('Program not found')

    const exercises = await Promise.all(
      program.exercises.map(async (exerciseId) => {
        const exercise = exercisesStore.find(exerciseId) ?? (await exercisesStore.getById(exerciseId))
        return exercise ? snapshotFromExercise(exercise) : placeholderSnapshot(exerciseId)
      })
    )

    const { date, location } = this.planned()
    const notes = this.notesInput.value
    return workoutSessionsStore.create({ programId: this.programId, date, location, exercises, notes })
  }

  private static async save() {
    const { date, location } = this.planned()
    const notes = this.notesInput.value
    await openSession.apply((session) => workoutSessionsStore.update(session, { date, location, notes }))
  }

  // "Today · Athens", or the day as "Oct 11" when it is another one.
  private static showSummary() {
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
  private static showGymOptions(names: Array<string>) {
    this.gymOptions.replaceChildren(...names.map((name) => new Option(name)))
  }
}

export default WorkoutSessionForm
