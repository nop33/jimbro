import { EXERCISE_KIND_LABELS, formatPrescription } from '../../db/exerciseLogging'
import { muscleGroupLabel } from '../../db/muscleGroups'
import type { Exercise } from '../../db/stores/exercisesStore'
import type { Program } from '../../db/stores/programsStore'

// The page of one program.
export const programPageUrl = (id: Program['id']) => `/programs/program/?id=${encodeURIComponent(id)}`

// An exercise's muscle group, or its kind when it works none, as cardio does.
export const exerciseGroupLabel = ({ muscle, kind }: Exercise) =>
  muscle ? muscleGroupLabel(muscle) : EXERCISE_KIND_LABELS[kind]

// "Chest · 4 sets × 8 reps"
export const exerciseDetail = (exercise: Exercise) =>
  `${exerciseGroupLabel(exercise)} · ${formatPrescription(exercise)}`

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

// "6 exercises · 24 sets", counting the exercises that still exist.
export const programTotals = (exercises: Array<Exercise>) =>
  `${plural(exercises.length, 'exercise')} · ${plural(
    exercises.reduce((sets, { targetSets }) => sets + targetSets, 0),
    'set'
  )}`
