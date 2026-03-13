import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseList {
  private static exercisesGrid = document.querySelector('#exercises-grid') as HTMLDivElement
  private static muscleFilter: MuscleGroupSelect | null = null

  static async init() {
    this.renderMuscleGroupExercises(exercisesStore.get(), 'All')
    this.renderMuscleFilter()

    exercisesStore.subscribe((exercises) =>
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
      onSelect: (muscleGroup) => this.renderMuscleGroupExercises(exercisesStore.get(), muscleGroup)
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
