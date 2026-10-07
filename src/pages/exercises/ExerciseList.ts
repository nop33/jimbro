import { exercises, type Exercise } from '../../db/stores/exercisesStore'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseList {
  private static exercisesGrid = document.querySelector('#exercises-grid') as HTMLDivElement
  private static muscleFilter: MuscleGroupSelect | null = null

  static init() {
    this.renderMuscleGroupExercises(exercises.exercises, 'All')
    this.renderMuscleFilter()

    exercises.subscribe((allExercises) =>
      this.renderMuscleGroupExercises(allExercises, this.muscleFilter?.selectedMuscle || 'All')
    )
  }

  static renderMuscleGroupExercises(allExercises: Array<Exercise>, muscleGroup: string) {
    const filteredExercises = this.filterExercises(allExercises, muscleGroup)
    this.exercisesGrid.innerHTML = ''
    this.exercisesGrid.append(...filteredExercises.map((exercise) => new ExerciseComponent(exercise).render()))
  }

  private static renderMuscleFilter() {
    this.muscleFilter = new MuscleGroupSelect({
      selector: '#muscle-filter',
      onSelect: (muscleGroup) => this.renderMuscleGroupExercises(exercises.exercises, muscleGroup)
    })

    this.muscleFilter.render({ includeOptionAll: true })
  }

  private static filterExercises(allExercises: Array<Exercise>, selectedMuscle: string) {
    return selectedMuscle === 'All' || !selectedMuscle
      ? allExercises
      : allExercises.filter((exercise) => exercise.muscle === selectedMuscle)
  }
}

export default ExerciseList
