import { exercisesStore, MUSCLE_GROUPS, type Exercise } from '../../db/stores/exercisesStore';
import '../../style.css';
import ExerciseComponent from './ExerciseComponent';

class ExerciseList {
  private static exercisesGrid = document.querySelector('#exercises-grid') as HTMLDivElement
  private static exercises: Array<Exercise> = []

  static init() {
    this.setupMuscleFilter()
    this.reload()
  }

  private static reset() {
    this.exercisesGrid.innerHTML = ''
  }

  static render(exercises: Array<Exercise>) {
    this.reset()
    this.exercisesGrid.append(...exercises.map((exercise) => new ExerciseComponent(exercise).render()))
  }

  static async reload() {
    this.exercises = await exercisesStore.getAllExercises()
    this.render(this.exercises)
  }

  static setupMuscleFilter() {
    const muscleFilter = document.querySelector('#muscle-filter') as HTMLSelectElement
    muscleFilter.innerHTML = '<option value="">Select muscle group...</option>' +
      `<option value="All">All</option>` +
      MUSCLE_GROUPS.map((muscle) => `<option value="${muscle}">${muscle}</option>`).join('');

    muscleFilter.addEventListener('change', (e) => {
      const selectedMuscle = (e.target as HTMLSelectElement).value

      if (selectedMuscle === 'All' || !selectedMuscle) {
        this.render(this.exercises)
      } else {
        const filteredExercises = this.exercises.filter((exercise) => exercise.muscle === selectedMuscle)
        this.render(filteredExercises)
      }
    })
  }
}

export default ExerciseList
