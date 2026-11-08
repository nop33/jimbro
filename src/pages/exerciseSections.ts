import { EXERCISE_KINDS, EXERCISE_KIND_LABELS } from '../db/exerciseLogging'
import { muscleGroupLabel } from '../db/muscleGroups'
import type { Exercise } from '../db/stores/exercisesStore'

// The section an exercise sits in where exercises are picked: a lift under its muscle, rehab and cardio under their
// kind, so a rehab exercise doesn't hide among the lifts for its muscle and cardio, which works no muscle, has one.
export const exerciseSection = ({ kind, muscle }: Pick<Exercise, 'kind' | 'muscle'>) =>
  kind === 'lifting' && muscle ? muscleGroupLabel(muscle) : EXERCISE_KIND_LABELS[kind]

// The sections of the exercises that work no single muscle the way a lift does, in the order they come.
export const KIND_SECTIONS = EXERCISE_KINDS.filter((kind) => kind !== 'lifting').map(
  (kind) => EXERCISE_KIND_LABELS[kind]
)

const kindRank = (section: string) => EXERCISE_KINDS.findIndex((kind) => EXERCISE_KIND_LABELS[kind] === section)

// The exercises by section: the muscles in alphabetical order, then Rehab, then Cardio, each section's exercises by
// name, so an exercise is where one looks for it.
export const exerciseSections = <E extends Pick<Exercise, 'kind' | 'muscle' | 'name'>>(exercises: ReadonlyArray<E>) => {
  const sections = new Map<string, Array<E>>()
  for (const exercise of [...exercises].sort((a, b) => a.name.localeCompare(b.name))) {
    const section = exerciseSection(exercise)
    sections.set(section, [...(sections.get(section) ?? []), exercise])
  }
  return [...sections].sort(([a], [b]) => Math.max(kindRank(a), 0) - Math.max(kindRank(b), 0) || a.localeCompare(b))
}
