import { SnapshotCounts } from './types'

export interface ShrinkGuardResult {
  passed: boolean
  rule?: string
  isHardRule?: boolean
}

export function checkShrinkGuard(prev: SnapshotCounts, next: SnapshotCounts, force: boolean): ShrinkGuardResult {
  // Hard rules: exercises and programs are soft-deleted, counts must never decrease
  if (next.exercises < prev.exercises) return { passed: false, rule: 'exercises_count_decreased', isHardRule: true }
  if (next.programs < prev.programs) return { passed: false, rule: 'programs_count_decreased', isHardRule: true }

  // Soft rule: workout sessions can decrease (hard-delete), but not drastically
  const threshold = Math.max(3, Math.floor(prev.workoutSessions * 0.1))
  if (next.workoutSessions < prev.workoutSessions - threshold) {
    if (force) return { passed: true }
    return { passed: false, rule: 'sessions_count_dropped', isHardRule: false }
  }

  return { passed: true }
}
