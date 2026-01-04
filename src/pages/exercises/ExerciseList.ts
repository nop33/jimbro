import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseList {
  private static exercisesGrid = document.querySelector('#exercises-grid') as HTMLDivElement
  private static muscleFilter: MuscleGroupSelect | null = null

  static init() {
    exercisesStore.subscribe((exercises) => {
      const filteredExercises = this.filterExercises(exercises, this.muscleFilter?.selectedMuscle || 'All')
      this.render(filteredExercises)
    })
    this.renderMuscleFilter()
  }

  static render(exercises: Array<Exercise>) {
    this.exercisesGrid.innerHTML = ''
    this.exercisesGrid.append(...exercises.map((exercise) => new ExerciseComponent(exercise).render()))
  }

  private static renderMuscleFilter() {
    this.muscleFilter = new MuscleGroupSelect({
      selector: '#muscle-filter',
      onSelect: (selectedMuscle) => {
        const filteredExercises = this.filterExercises(exercisesStore.get(), selectedMuscle)
        this.render(filteredExercises)
      }
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
