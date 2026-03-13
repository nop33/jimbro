import type { Exercise } from '../../db/stores/exercisesStore'
import ExercisesState from '../../state/ExercisesState'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseList {
  private static exercisesGrid = document.querySelector('#exercises-grid') as HTMLDivElement
  private static muscleFilter: MuscleGroupSelect | null = null

  static init() {
    this.renderMuscleGroupExercises(ExercisesState.exercises, 'All')
    this.renderMuscleFilter()

    ExercisesState.subscribe((exercises) =>
      this.renderMuscleGroupExercises(exercises, this.muscleFilter?.selectedMuscle || 'All')
    )
  }

  static renderMuscleGroupExercises(exercises: Array<Exercise>, muscleGroup: string) {
    const filteredExercises = this.filterExercises(exercises, muscleGroup)
    this.exercisesGrid.innerHTML = ''
    this.exercisesGrid.append(...filteredExercises.map((exercise) => new ExerciseComponent(exercise).render()))
  }

  private static renderMuscleFilter() {
    this.muscleFilter = new MuscleGroupSelect({
      selector: '#muscle-filter',
      onSelect: (muscleGroup) => this.renderMuscleGroupExercises(ExercisesState.exercises, muscleGroup)
    })

    this.muscleFilter.render({ includeOptionAll: true })
  }

  private static filterExercises(exercises: Array<Exercise>, selectedMuscle: string) {
    return selectedMuscle === 'All' || !selectedMuscle
      ? exercises
      : exercises.filter((exercise) => exercise.muscle === selectedMuscle)
  }
}

export default ExerciseList
