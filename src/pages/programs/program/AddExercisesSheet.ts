import { exercisesStore, type Exercise } from '../../../db/stores/exercisesStore'
import { nodeFromTemplate, setTextContent } from '../../../utils'
import { exerciseGroupLabel } from '../programExercises'

// Picks exercises to add to the program: a full-height sheet with a search field and a checklist grouped by muscle.
// The exercises already in the program show ticked and greyed out. The checked ones join the program's end in the
// order they were checked.
class AddExercisesSheet {
  private dialog = document.querySelector('#add-exercises-dialog') as HTMLDialogElement
  private form = document.querySelector('#add-exercises-form') as HTMLFormElement
  private search = document.querySelector('#exercise-search') as HTMLInputElement
  private choices = document.querySelector('#exercise-choices') as HTMLDivElement
  private submit = document.querySelector('#add-exercises-submit') as HTMLButtonElement
  private noMatch = document.querySelector('#no-exercise-match') as HTMLParagraphElement
  private noExercises = document.querySelector('#no-exercises') as HTMLParagraphElement
  private body = this.dialog.querySelector('.dialog-sheet-body') as HTMLDivElement
  private checked: Array<Exercise['id']> = []

  constructor(add: (ids: Array<Exercise['id']>) => void) {
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.dialog.close())
    this.search.addEventListener('input', () => this.filter())
    this.choices.addEventListener('change', (event) => {
      const box = event.target as HTMLInputElement
      this.checked = box.checked ? [...this.checked, box.value] : this.checked.filter((id) => id !== box.value)
      this.showCount()
    })
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (this.checked.length > 0) add(this.checked)
      this.dialog.close()
    })
  }

  open(inProgram: ReadonlySet<Exercise['id']>) {
    this.checked = []
    this.search.value = ''
    const groups = new Map<string, Array<Exercise>>()
    // Groups in alphabetical order, and exercises in each group too, so an exercise is where one looks for it.
    const sorted = [...exercisesStore.all].sort(
      (a, b) => exerciseGroupLabel(a).localeCompare(exerciseGroupLabel(b)) || a.name.localeCompare(b.name)
    )
    for (const exercise of sorted) {
      const label = exerciseGroupLabel(exercise)
      groups.set(label, [...(groups.get(label) ?? []), exercise])
    }
    this.choices.replaceChildren(
      ...[...groups].map(([label, exercises]) => {
        const group = nodeFromTemplate('#exercise-choice-group-template')
        setTextContent('.exercise-choice-group-title', label, group)
        ;(group.querySelector('.exercise-choice-list') as HTMLDivElement).append(
          ...exercises.map((exercise) => this.choice(exercise, inProgram.has(exercise.id)))
        )
        return group
      })
    )
    this.noExercises.hidden = exercisesStore.all.length > 0
    this.noMatch.hidden = true
    this.showCount()
    this.dialog.showModal()
    this.body.scrollTop = 0
  }

  private choice(exercise: Exercise, inProgram: boolean) {
    const fragment = nodeFromTemplate('#exercise-choice-template')
    setTextContent('.exercise-choice-name', exercise.name, fragment)
    const box = fragment.querySelector('input') as HTMLInputElement
    box.value = exercise.id
    box.checked = inProgram
    box.disabled = inProgram
    return fragment
  }

  private showCount() {
    const count = this.checked.length
    this.submit.disabled = count === 0
    this.submit.textContent = count === 0 ? 'Add exercises' : `Add ${count} ${count === 1 ? 'exercise' : 'exercises'}`
  }

  // Shows the exercises whose name holds the search, and only the groups left with one.
  private filter() {
    const query = this.search.value.trim().toLocaleLowerCase()
    let any = false
    for (const group of this.choices.querySelectorAll<HTMLElement>('.exercise-choice-group')) {
      let shown = 0
      for (const choice of group.querySelectorAll<HTMLLabelElement>('.exercise-choice')) {
        const name = choice.querySelector('.exercise-choice-name')?.textContent?.toLocaleLowerCase() ?? ''
        choice.hidden = !name.includes(query)
        if (!choice.hidden) shown++
      }
      group.hidden = shown === 0
      any ||= shown > 0
    }
    this.noMatch.hidden = any || exercisesStore.all.length === 0
  }
}

export default AddExercisesSheet
