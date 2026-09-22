import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'
import { WorkoutSessionsStore, type WorkoutSession } from '../src/db/stores/workoutSessionsStore'
import { storage } from '../src/db/storage'

vi.mock('../src/db/storage', () => ({
  storage: {
    getFirstByPredicate: vi.fn()
  }
}))

describe('getLatestSavedWorkoutSession', () => {
  const store = new WorkoutSessionsStore()

  beforeEach(() => {
    vi.mocked(storage.getFirstByPredicate).mockReset()
  })

  it('returns the latest persisted session by date index', async () => {
    const session = { id: '1', status: 'completed' } as WorkoutSession
    vi.mocked(storage.getFirstByPredicate).mockResolvedValue(session)

    await expect(store.getLatestSavedWorkoutSession()).resolves.toBe(session)
    expect(storage.getFirstByPredicate).toHaveBeenCalledWith(
      'workoutSessions',
      'date',
      'prev',
      expect.any(Function)
    )
  })

  it('predicate accepts completed and incomplete sessions only', async () => {
    vi.mocked(storage.getFirstByPredicate).mockImplementation(async (_store, _index, _dir, predicate) => {
      const completed = { status: 'completed' } as WorkoutSession
      const incomplete = { status: 'incomplete' } as WorkoutSession
      expect(predicate(completed)).toBe(true)
      expect(predicate(incomplete)).toBe(true)
      expect(predicate({ status: 'pending' } as WorkoutSession)).toBe(false)
      return incomplete
    })

    await store.getLatestSavedWorkoutSession()
  })
})
