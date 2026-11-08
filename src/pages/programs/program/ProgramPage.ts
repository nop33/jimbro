import { exercisesStore, type Exercise } from '../../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../../db/stores/programsStore'
import Toasts from '../../../features/toasts'
import { programTotals } from '../programExercises'
import AddExercisesSheet from './AddExercisesSheet'
import ProgramExerciseRows from './ProgramExerciseRows'
import RenameProgramDialog from './RenameProgramDialog'

// One program's page. Every change saves as it is made, as a workout's do: reorder, remove, add, rename, delete.
class ProgramPage {
  private title = document.querySelector('#program-title') as HTMLHeadingElement
  private content = document.querySelector('#program-content') as HTMLDivElement
  private missing = document.querySelector('#program-missing') as HTMLParagraphElement
  private start = document.querySelector('#start-program') as HTMLAnchorElement
  private totals = document.querySelector('#program-totals') as HTMLSpanElement
  private hint = document.querySelector('#program-rows-hint') as HTMLParagraphElement

  private rows = new ProgramExerciseRows({
    reorder: (visible) => {
      // An exercise deleted since it joined stays in the program, after the ones that show.
      const hidden = this.program?.exercises.filter((id) => !visible.includes(id)) ?? []
      void this.save({ exercises: [...visible, ...hidden] })
    },
    remove: (id) => void this.save({ exercises: this.program?.exercises.filter((other) => other !== id) })
  })

  private id: Program['id']
  private sheet = new AddExercisesSheet(
    (ids) => void this.save({ exercises: [...(this.program?.exercises ?? []), ...ids] })
  )
  private renameDialog = new RenameProgramDialog((name) => void this.save({ name }))

  constructor(id: Program['id'], signal: AbortSignal) {
    this.id = id
    ;(document.querySelector('#add-exercises-btn') as HTMLButtonElement).addEventListener('click', () =>
      this.openSheet()
    )
    ;(document.querySelector('#rename-program-btn') as HTMLButtonElement).addEventListener('click', () =>
      this.renameDialog.open(this.program?.name ?? '')
    )
    ;(document.querySelector('#delete-program-btn') as HTMLButtonElement).addEventListener(
      'click',
      () => void this.delete()
    )

    this.render()
    const unsubscribe = programsStore.subscribe(() => this.render())
    signal.addEventListener('abort', unsubscribe)
  }

  private get program() {
    return programsStore.find(this.id)
  }

  openSheet() {
    this.sheet.open(new Set(this.program?.exercises))
  }

  private render() {
    const program = this.program
    this.content.hidden = !program
    this.missing.hidden = Boolean(program)
    if (!program) return

    this.title.textContent = program.name
    document.title = `Jimbro - ${program.name}`
    const exercises = program.exercises
      .map((id) => exercisesStore.find(id))
      .filter((exercise): exercise is Exercise => exercise !== undefined)
    this.totals.textContent = programTotals(exercises)
    this.start.href = `/gymtime/?programId=${encodeURIComponent(program.id)}`
    this.start.hidden = exercises.length === 0
    this.hint.hidden = exercises.length < 2
    this.rows.render(program.exercises)
  }

  private async save(change: Partial<Pick<Program, 'name' | 'exercises'>>) {
    const program = this.program
    if (!program) return
    try {
      await programsStore.update({ ...program, ...change })
    } catch (error) {
      console.error('Error saving program:', error)
      Toasts.show({ message: `Could not save program: ${String(error)}`, type: 'error' })
    }
  }

  private async delete() {
    if (!confirm('Are you sure you want to delete this program?')) return
    try {
      await programsStore.remove(this.id)
      Toasts.show({ message: 'Program deleted.' })
      location.replace('/programs/')
    } catch (error) {
      console.error('Error deleting program:', error)
      Toasts.show({ message: `Could not delete program: ${String(error)}`, type: 'error' })
    }
  }
}

export default ProgramPage
