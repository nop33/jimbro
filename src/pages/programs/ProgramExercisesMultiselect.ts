import EventEmitter from '../../eventEmitter'
import { muscleGroupLabel } from '../../db/muscleGroups'
import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
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
    for (const exercise of exercisesStore.all) {
      const group = exercise.muscle ? muscleGroupLabel(exercise.muscle) : 'Cardio'
      if (!groupMap.has(group)) {
        groupMap.set(group, [])
      }
      groupMap.get(group)!.push(exercise)
    }

    this.exercisesSelection.replaceChildren(
      ...Array.from(groupMap.entries()).map(([group, exercises]) => {
        const optgroup = document.createElement('optgroup')
        optgroup.label = group
        optgroup.append(
          ...exercises.map((exercise) => {
            const isSelected = selectedExercises.has(exercise.id)
            return new Option(exercise.name, exercise.id, isSelected, isSelected)
          })
        )
        return optgroup
      })
    )
  }
}

export default ProgramExercisesMultiselect
