import { exercisesStore, type Exercise } from '../../../db/stores/exercisesStore'
import { requireElement } from '../../../utils'
import ExerciseComponent from './ExerciseComponent'
import MuscleGroupSelect, { type MuscleGroupSelectEventMap } from './MuscleGroupSelect'

class ExerciseList {
  private exercisesGrid: HTMLDivElement
  private muscleFilter: MuscleGroupSelect
  private unsubscribe: () => void
  private handleExerciseClicked?: (exercise: Exercise) => void
  private exerciseComponents: Array<ExerciseComponent> = []

  constructor(selector: string, handleExerciseClicked?: (exercise: Exercise) => void) {
    this.exercisesGrid = requireElement(selector)
    this.handleExerciseClicked = handleExerciseClicked
    this.muscleFilter = new MuscleGroupSelect('#muscle-filter')
    this.muscleFilter.on('muscle-group-selected', this.handleMuscleGroupSelected)
    this.unsubscribe = exercisesStore.subscribe(() => this.renderMuscleGroupExercises(this.muscleFilter.selectedMuscle))
  }

  async init() {
    this.render(exercisesStore.getFromMemory())
    this.muscleFilter.render({ includeOptionAll: true })
  }

  render(exercises: Array<Exercise>) {
    this.exercisesGrid.innerHTML = ''
    this.exercisesGrid.append(
      ...exercises.map((exercise) => {
        const exerciseComponent = new ExerciseComponent(exercise, this.handleExerciseClicked)
        this.exerciseComponents.push(exerciseComponent)
        return exerciseComponent.getElement()
      })
    )
  }

  private handleMuscleGroupSelected = (event: CustomEvent<MuscleGroupSelectEventMap['muscle-group-selected']>) => {
    this.renderMuscleGroupExercises(event.detail.muscleGroup)
  }

  private renderMuscleGroupExercises = (selectedMuscle = 'All') => {
    const filteredExercises = this.filterExercises(exercisesStore.getFromMemory(), selectedMuscle)
    this.render(filteredExercises)
  }

  private filterExercises(exercises: Array<Exercise>, selectedMuscle: string) {
    return selectedMuscle === 'All' || !selectedMuscle
      ? exercises
      : exercises.filter((exercise) => exercise.muscle === selectedMuscle)
  }

  destroy() {
    this.muscleFilter.off('muscle-group-selected', this.handleMuscleGroupSelected)
    this.muscleFilter.destroy()
    this.exerciseComponents.forEach((exerciseComponent) => exerciseComponent.destroy())
    this.exerciseComponents = []
    this.unsubscribe()
  }
}

export default ExerciseList
