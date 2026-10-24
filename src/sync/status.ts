const LAST_SYNC_KEY = 'jimbro.sync.lastAt'

export const setLastSyncAt = (iso: string) => localStorage.setItem(LAST_SYNC_KEY, iso)

export const getLastSyncAt = () => localStorage.getItem(LAST_SYNC_KEY)

export const clearLastSyncAt = () => localStorage.removeItem(LAST_SYNC_KEY)

const PROBLEM_KEY = 'jimbro.sync.problem'

// A problem a retry cannot fix, which the app shows until a sync succeeds: row_limit, when the backup holds as many
// rows as the worker takes for one account, and moved, when a sign-in on another device moved the account there and
// this device stopped backing up.
export const SYNC_PROBLEMS = ['row_limit', 'moved'] as const
export type SyncProblem = (typeof SYNC_PROBLEMS)[number]

export const setSyncProblem = (problem: SyncProblem | null) => {
  if (problem) localStorage.setItem(PROBLEM_KEY, problem)
  else localStorage.removeItem(PROBLEM_KEY)
}

export const getSyncProblem = (): SyncProblem | null => {
  const stored = localStorage.getItem(PROBLEM_KEY)
  return SYNC_PROBLEMS.find((problem) => problem === stored) ?? null
}
