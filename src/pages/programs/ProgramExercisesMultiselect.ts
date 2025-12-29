import { exercisesStore, type Exercise } from "../../db/stores/exercisesStore";
import type { ExercisesListProps } from "./programTypes";

interface ProgramExercisesMultiselectProps {
  onSelect: (selectedExerciseIds: Array<Exercise['id']>) => void;
}

class ProgramExercisesMultiselect {
  private static exercisesSelection = document.querySelector('#exercises-selection') as HTMLSelectElement;

  static init({ onSelect }: ProgramExercisesMultiselectProps) {
    this.exercisesSelection.addEventListener('change', (e) => {
      const selectedExerciseIds = Array.from((e.target as HTMLSelectElement).selectedOptions).map((option) => option.value)

      onSelect(selectedExerciseIds)
    })
  }

  static render({ selectedExercises }: ExercisesListProps) {
    const allExercises = exercisesStore.get()
    const groupMap = new Map<string, Exercise[]>();
    for (const exercise of allExercises) {
      if (!groupMap.has(exercise.muscle)) {
        groupMap.set(exercise.muscle, []);
      }
      groupMap.get(exercise.muscle)!.push(exercise);
    }

    this.exercisesSelection.innerHTML = Array.from(groupMap.entries()).map(([muscle, exercises]) => {
      const options = exercises.map((exercise) => {
        const isSelected = selectedExercises.has(exercise.id);
        return `<option class="multiselect-option" value="${exercise.id}"${isSelected ? " selected" : ""}>${exercise.name}</option>`;
      }).join('');
      return `<optgroup label="${muscle}">${options}</optgroup>`;
    }).join('');
  }
}

export default ProgramExercisesMultiselect
