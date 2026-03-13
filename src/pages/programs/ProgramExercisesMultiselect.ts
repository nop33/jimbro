import EventEmitter from '../../eventEmitter'
import type { Exercise } from '../../db/stores/exercisesStore'
import ExercisesState from '../../state/ExercisesState'
import type { ExercisesListProps } from './programTypes'

type ProgramExercisesMultiselectEventMap = {
  'exercise-selected': { selectedExerciseIds: Array<Exercise['id']> }
}

class ProgramExercisesMultiselect extends EventEmitter<ProgramExercisesMultiselectEventMap> {
  private exercisesSelection: HTMLSelectElement

  constructor(selector: string) {
    super()
    this.exercisesSelection = document.querySelector(selector) as HTMLSelectElement
    this.init()
  }

  private init() {
    this.exercisesSelection.addEventListener('change', (e) => {
      const selectedExerciseIds = Array.from((e.target as HTMLSelectElement).selectedOptions).map(
        (option) => option.value
      )

      this.emit('exercise-selected', { selectedExerciseIds })
    })
  }

  render({ selectedExercises }: ExercisesListProps) {
    const groupMap = new Map<string, Exercise[]>()
    for (const exercise of ExercisesState.exercises) {
      if (!groupMap.has(exercise.muscle)) {
        groupMap.set(exercise.muscle, [])
      }
      groupMap.get(exercise.muscle)!.push(exercise)
    }

    this.exercisesSelection.innerHTML = Array.from(groupMap.entries())
      .map(([muscle, exercises]) => {
        const options = exercises
          .map((exercise) => {
            const isSelected = selectedExercises.has(exercise.id)
            return `<option class="multiselect-option" value="${exercise.id}"${isSelected ? ' selected' : ''}>${exercise.name}</option>`
          })
          .join('')
        return `<optgroup label="${muscle}">${options}</optgroup>`
      })
      .join('')
  }
}

export default ProgramExercisesMultiselect
