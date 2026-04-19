const STORAGE_KEY = 'jimbro.workoutMode'

export const WORKOUT_MODES = ['rotation', 'freestyle'] as const
export type WorkoutMode = (typeof WORKOUT_MODES)[number]

export interface WorkoutModeSettings {
  mode: WorkoutMode
  weeklyGoal: number
}

const DEFAULT_SETTINGS: WorkoutModeSettings = {
  mode: 'rotation',
  weeklyGoal: 3
}

export const getWorkoutModeSettings = (): WorkoutModeSettings => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_SETTINGS

  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const storeWorkoutModeSettings = (settings: WorkoutModeSettings) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export const getEffectiveWorkoutsPerWeek = (programCount: number): number => {
  const settings = getWorkoutModeSettings()
  return settings.mode === 'rotation' ? programCount : settings.weeklyGoal
}
