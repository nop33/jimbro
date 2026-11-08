import { exercisesStore, type Exercise } from '../db/stores/exercisesStore'
import { muscleGroupLabel } from '../db/muscleGroups'
import { nodeFromTemplate, setTextContent } from '../utils'
import { exerciseSections, KIND_SECTIONS } from './exerciseSections'
import { pullDownToClose } from '../features/bottomSheet'

const ALL = 'All'

interface Opening {
  title: string
  // The exercises already where they would go, shown greyed out with the note, which can't be picked again.
  taken: ReadonlySet<Exercise['id']>
  takenNote: string
}

// Picks exercises from partials/exercise-picker.html: a full-height sheet with a search, a chip per section to filter
// by, and the exercises grouped by section. `add` ticks several and adds them in the order ticked, as a program and a
// workout do. `pick` takes the one tapped, as a swap does.
class ExercisePicker {
  private dialog = document.querySelector('#exercise-picker') as HTMLDialogElement
  private form = document.querySelector('#exercise-picker-form') as HTMLFormElement
  private title = document.querySelector('#exercise-picker-title') as HTMLHeadingElement
  private search = document.querySelector('#exercise-search') as HTMLInputElement
  private filterChips = document.querySelector('#exercise-filter') as HTMLDivElement
  private choices = document.querySelector('#exercise-choices') as HTMLDivElement
  private footer = document.querySelector('#exercise-picker-footer') as HTMLElement
  private submit = document.querySelector('#exercise-picker-submit') as HTMLButtonElement
  private noMatch = document.querySelector('#no-exercise-match') as HTMLParagraphElement
  private noExercises = document.querySelector('#no-exercises') as HTMLParagraphElement
  private noSectionExercises = document.querySelector('#no-section-exercises') as HTMLParagraphElement
  private section = ALL
  private body = this.dialog.querySelector('.dialog-sheet-body') as HTMLDivElement
  private checked: Array<Exercise['id']> = []
  private onAdd: (exercises: Array<Exercise>) => void = () => {}
  private onPick: (exercise: Exercise) => void = () => {}

  constructor() {
    pullDownToClose(this.dialog)
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.dialog.close())
    this.search.addEventListener('input', () => this.filter())
    // Tapping the chip already chosen goes back to All, which a radio can't do by itself. A radio's click comes before
    // its change, so the section is still the one chosen before.
    this.filterChips.addEventListener('click', (event) => {
      const radio = event.target as HTMLInputElement
      if (radio.type !== 'radio' || radio.value !== this.section || radio.value === ALL) return
      ;(this.filterChips.querySelector(`input[value="${ALL}"]`) as HTMLInputElement).checked = true
      this.choose(ALL)
    })
    this.filterChips.addEventListener('change', (event) => this.choose((event.target as HTMLInputElement).value))
    this.choices.addEventListener('change', (event) => {
      const box = event.target as HTMLInputElement
      this.checked = box.checked ? [...this.checked, box.value] : this.checked.filter((id) => id !== box.value)
      this.showCount()
    })
    this.choices.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button.exercise-choice')
      const exercise = button && exercisesStore.find(button.value)
      if (!exercise) return
      this.dialog.close()
      this.onPick(exercise)
    })
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      const exercises = this.checked.map((id) => exercisesStore.find(id)).filter((exercise) => exercise !== undefined)
      this.dialog.close()
      if (exercises.length > 0) this.onAdd(exercises)
    })
  }

  add(opening: Opening, add: (exercises: Array<Exercise>) => void) {
    this.onAdd = add
    this.open(opening, 'add')
  }

  pick(opening: Opening, pick: (exercise: Exercise) => void) {
    this.onPick = pick
    this.open(opening, 'pick')
  }

  private open({ title, taken, takenNote }: Opening, mode: 'add' | 'pick') {
    this.title.textContent = title
    this.footer.hidden = mode === 'pick'
    this.checked = []
    this.search.value = ''
    const sections = exerciseSections(exercisesStore.all)
    // All, then Rehab and Cardio, which always show so they can be found even before there is one, then the muscles
    // there are exercises for. A divider sets each kind of chip apart.
    const muscles = sections.map(([section]) => section).filter((section) => !KIND_SECTIONS.includes(section))
    this.filterChips.replaceChildren(
      this.chip(ALL),
      ...[...KIND_SECTIONS.map((section) => [section]), muscles]
        .filter((chips) => chips.length > 0)
        .flatMap((chips) => [this.divider(), ...chips.map((section) => this.chip(section))])
    )
    this.filterChips.hidden = exercisesStore.all.length === 0
    this.section = ALL
    this.choices.replaceChildren(
      ...sections.map(([section, exercises]) => {
        const group = nodeFromTemplate('#exercise-choice-group-template')
        const element = group.querySelector('.exercise-choice-group') as HTMLElement
        element.dataset.section = section
        setTextContent('.exercise-choice-group-title', section, group)
        ;(group.querySelector('.exercise-choice-list') as HTMLDivElement).append(
          ...exercises.map((exercise) => this.choice(exercise, mode, taken.has(exercise.id) ? takenNote : undefined))
        )
        return group
      })
    )
    this.noExercises.hidden = exercisesStore.all.length > 0
    this.noMatch.hidden = true
    this.noSectionExercises.hidden = true
    this.showCount()
    this.dialog.showModal()
    this.body.scrollTop = 0
    this.filterChips.scrollLeft = 0
  }

  private divider() {
    const divider = document.createElement('span')
    divider.className = 'exercise-filter-divider'
    divider.setAttribute('aria-hidden', 'true')
    return divider
  }

  private choose(section: string) {
    this.section = section
    this.filter()
    this.body.scrollTop = 0
  }

  private chip(section: string) {
    const fragment = nodeFromTemplate('#exercise-filter-chip-template')
    setTextContent('.exercise-filter-chip-label', section, fragment)
    const radio = fragment.querySelector('input') as HTMLInputElement
    radio.value = section
    radio.checked = section === ALL
    return fragment
  }

  private choice(exercise: Exercise, mode: 'add' | 'pick', takenNote: string | undefined) {
    const fragment = nodeFromTemplate(mode === 'add' ? '#exercise-choice-template' : '#exercise-pick-template')
    setTextContent('.exercise-choice-name', exercise.name, fragment)
    // Rehab sits in a section of its own, so its rows name the muscle it works.
    const muscle = fragment.querySelector('.exercise-choice-muscle') as HTMLSpanElement
    if (exercise.kind === 'rehab' && exercise.muscle) {
      muscle.textContent = muscleGroupLabel(exercise.muscle)
      muscle.hidden = false
    }
    const note = fragment.querySelector('.exercise-choice-note') as HTMLSpanElement
    note.textContent = takenNote ?? ''
    note.hidden = takenNote === undefined
    const control = fragment.querySelector(mode === 'add' ? 'input' : 'button') as HTMLInputElement | HTMLButtonElement
    control.value = exercise.id
    control.disabled = takenNote !== undefined
    if (control instanceof HTMLInputElement) control.checked = takenNote !== undefined
    return fragment
  }

  private showCount() {
    const count = this.checked.length
    this.submit.disabled = count === 0
    this.submit.textContent = count === 0 ? 'Add exercises' : `Add ${count} ${count === 1 ? 'exercise' : 'exercises'}`
  }

  // Shows the exercises in the chosen section whose name holds the search, and only the sections left with one. A
  // section with no exercise at all says so, and links to where one is made.
  private filter() {
    const query = this.search.value.trim().toLocaleLowerCase()
    const section = this.section
    let any = false
    for (const group of this.choices.querySelectorAll<HTMLElement>('.exercise-choice-group')) {
      let shown = 0
      for (const choice of group.querySelectorAll<HTMLElement>('.exercise-choice')) {
        const name = choice.querySelector('.exercise-choice-name')?.textContent?.toLocaleLowerCase() ?? ''
        choice.hidden = !name.includes(query)
        if (!choice.hidden) shown++
      }
      group.hidden = shown === 0 || (section !== ALL && group.dataset.section !== section)
      any ||= !group.hidden
    }
    const emptySection =
      section !== ALL && !this.choices.querySelector(`.exercise-choice-group[data-section="${section}"]`)
    setTextContent('.no-section-exercises-text', `No ${section.toLocaleLowerCase()} exercises yet.`, this.dialog)
    this.noSectionExercises.hidden = !emptySection
    this.noMatch.hidden = any || emptySection || exercisesStore.all.length === 0
  }
}

export default ExercisePicker
