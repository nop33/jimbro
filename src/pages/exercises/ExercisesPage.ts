import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import { requireElement } from '../../utils'
import ExerciseDialog from './components/ExerciseDialog'
import ExerciseList from './components/ExerciseList'

class ExercisesPage {
  private dialog: ExerciseDialog
  private newExerciseButton: HTMLButtonElement
  private exerciseList: ExerciseList

  constructor() {
    this.dialog = new ExerciseDialog('#exercise-dialog')
    this.exerciseList = new ExerciseList('#exercises-grid', this.handleExerciseClicked)
    this.newExerciseButton = requireElement('#new-exercise-btn')
  }

  async init() {
    await exercisesStore.initialize()

    this.exerciseList.init()
    this.newExerciseButton.addEventListener('click', this.newExerciseHandler)
  }

  private newExerciseHandler = () => {
    this.dialog.render()
    this.dialog.openDialog()
  }

  private handleExerciseClicked = (exercise: Exercise) => {
    this.dialog.render(exercise)
    this.dialog.openDialog()
  }

  destroy() {
    this.newExerciseButton.removeEventListener('click', this.newExerciseHandler)
  }
}

export default ExercisesPage
