import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'
import { WorkoutSessionsStore } from '../src/db/stores/workoutSessionsStore'
import type { SessionHeader } from '../src/db/types'
import { storage } from '../src/db/storage'

vi.mock('../src/db/storage', () => ({
  storage: {
    getFirstByPredicate: vi.fn(),
    getAllByIndex: vi.fn()
  }
}))

const header = {
  id: '1',
  date: '2026-01-02',
  programId: 'prog-1',
  location: 'Zurich',
  status: 'completed',
  exercises: [],
  isDeleted: false,
  updatedAt: '2026-01-02T10:24:41.458Z'
} as SessionHeader

describe('getLatestSavedWorkoutSession', () => {
  const store = new WorkoutSessionsStore()

  beforeEach(() => {
    vi.mocked(storage.getFirstByPredicate).mockReset()
    vi.mocked(storage.getAllByIndex).mockReset()
    vi.mocked(storage.getAllByIndex).mockResolvedValue([])
  })

  it('returns the latest persisted session by date index', async () => {
    vi.mocked(storage.getFirstByPredicate).mockResolvedValue(header)

    const session = await store.getLatestSavedWorkoutSession()
    expect(session?.id).toBe('1')
    expect(session?.location).toBe('Zurich')
    expect(storage.getFirstByPredicate).toHaveBeenCalledWith('workoutSessions', 'date', 'prev', expect.any(Function))
  })

  it('predicate skips tombstones and accepts completed and incomplete sessions only', async () => {
    vi.mocked(storage.getFirstByPredicate).mockImplementation(async (_store, _index, _dir, predicate) => {
      const completed = { status: 'completed', isDeleted: false } as SessionHeader
      const incomplete = { status: 'incomplete', isDeleted: false } as SessionHeader
      const deleted = { status: 'completed', isDeleted: true } as SessionHeader
      const pending = { status: 'pending', isDeleted: false } as unknown as SessionHeader
      expect(predicate(completed)).toBe(true)
      expect(predicate(incomplete)).toBe(true)
      expect(predicate(deleted)).toBe(false)
      expect(predicate(pending)).toBe(false)
      return undefined
    })

    await expect(store.getLatestSavedWorkoutSession()).resolves.toBeUndefined()
  })
})
