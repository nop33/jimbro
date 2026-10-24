import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseList {
  private static get exercisesGrid() {
    return document.querySelector('#exercises-grid') as HTMLDivElement
  }
  private static muscleFilter: MuscleGroupSelect | null = null
  private static onExerciseClicked: (exercise: Exercise) => void = () => {}

  static init(onExerciseClicked: (exercise: Exercise) => void, signal: AbortSignal) {
    this.onExerciseClicked = onExerciseClicked
    this.renderMuscleGroupExercises(exercisesStore.all, 'All')
    this.renderMuscleFilter()

    const unsubscribe = exercisesStore.subscribe((exercises) =>
      this.renderMuscleGroupExercises(exercises, this.muscleFilter?.selectedMuscle || 'All')
    )
    signal.addEventListener('abort', unsubscribe)
  }

  static renderMuscleGroupExercises(exercises: Array<Exercise>, muscleGroup: string) {
    const filteredExercises = this.filterExercises(exercises, muscleGroup)
    this.exercisesGrid.innerHTML = ''
    this.exercisesGrid.append(
      ...filteredExercises.map((exercise) => new ExerciseComponent(exercise, this.onExerciseClicked).render())
    )
  }

  private static renderMuscleFilter() {
    this.muscleFilter = new MuscleGroupSelect({
      selector: '#muscle-filter',
      onSelect: (muscleGroup) => this.renderMuscleGroupExercises(exercisesStore.all, muscleGroup)
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
