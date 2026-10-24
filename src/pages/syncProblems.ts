import type { SyncProblem } from '../sync/status'

// What the pages tell the user about a sync problem: a toast once per page, and Settings after "Sync now".
export const PROBLEM_MESSAGES: Record<SyncProblem, string> = {
  row_limit: 'Your cloud backup is full. New changes stay on this phone.',
  moved: 'Your backup moved to another device. This phone keeps its workouts and stopped backing up.'
}
