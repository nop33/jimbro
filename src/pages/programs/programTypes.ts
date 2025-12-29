import type { Exercise } from "../../db/stores/exercisesStore";

export type ExercisesListProps = {
  selectedExercises: Set<Exercise['id']>;
  allExercises: Array<Exercise>;
}
