import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseList {
  private exercisesGrid = document.querySelector('#exercises-grid') as HTMLDivElement
  private muscleFilter: MuscleGroupSelect
  private onExerciseClicked: (exercise: Exercise) => void

  constructor(onExerciseClicked: (exercise: Exercise) => void, signal: AbortSignal) {
    this.onExerciseClicked = onExerciseClicked
    this.muscleFilter = new MuscleGroupSelect({
      selector: '#muscle-filter',
      onSelect: (muscleGroup) => this.renderMuscleGroupExercises(exercisesStore.all, muscleGroup)
    })
    this.muscleFilter.render({ includeOptionAll: true })
    this.renderMuscleGroupExercises(exercisesStore.all, 'All')

    const unsubscribe = exercisesStore.subscribe((exercises) =>
      this.renderMuscleGroupExercises(exercises, this.muscleFilter.selectedMuscle || 'All')
    )
    signal.addEventListener('abort', unsubscribe)
  }

  private renderMuscleGroupExercises(exercises: Array<Exercise>, muscleGroup: string) {
    const filteredExercises = this.filterExercises(exercises, muscleGroup)
    this.exercisesGrid.innerHTML = ''
    this.exercisesGrid.append(
      ...filteredExercises.map((exercise) => new ExerciseComponent(exercise, this.onExerciseClicked).render())
    )
  }

  private filterExercises(exercises: Array<Exercise>, selectedMuscle: string) {
    return selectedMuscle === 'All' || !selectedMuscle
      ? exercises
      : exercises.filter((exercise) => exercise.muscle === selectedMuscle)
  }
}

export default ExerciseList
