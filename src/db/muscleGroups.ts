export const MUSCLE_GROUPS = [
  'quads',
  'calves',
  'hamstrings',
  'glutes',
  'chest',
  'biceps',
  'triceps',
  'shoulders',
  'traps',
  'back',
  'core'
] as const

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  quads: 'Quads',
  calves: 'Calves',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  chest: 'Chest',
  biceps: 'Biceps',
  triceps: 'Triceps',
  shoulders: 'Shoulders',
  traps: 'Traps',
  back: 'Back',
  core: 'Core'
}

export const muscleGroupLabel = (muscle: string): string => MUSCLE_GROUP_LABELS[muscle as MuscleGroup] ?? muscle
