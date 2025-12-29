import { exercisesStore } from '../../db/stores/exercisesStore';
import '../../style.css';
import ExerciseDialog from "./ExerciseDialog";
import ExerciseList from "./ExerciseList";

exercisesStore.initialize()

ExerciseList.init()
ExerciseDialog.init()
