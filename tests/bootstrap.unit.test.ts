import { describe, expect, it } from 'vite-plus/test'
import { planBootstrap } from '../src/sync/bootstrap'
import type { ExerciseRow, Row } from '../src/sync/rows'

const exercise = (id: string, name: string): ExerciseRow => ({
  id,
  name,
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'quads',
  targetSets: 3,
  defaults: { reps: 5 },
  isDeleted: false,
  updatedAt: '2026-01-02T00:00:00.000Z'
})

const localRow = (id: string, name: string): Row => ({ table: 'exercises', row: exercise(id, name) })
const pulledRow = (id: string, name: string): Row => ({ table: 'exercises', row: exercise(id, name) })

const actionsOf = (local: Row[], pulled: Row[], isSnapshotWriter: boolean) =>
  Object.fromEntries(planBootstrap(local, pulled, isSnapshotWriter))

describe('planBootstrap', () => {
  const local = [localRow('only-local', 'Local only'), localRow('equal', 'Same'), localRow('diff', 'Phone')]
  const pulled = [pulledRow('equal', 'Same'), pulledRow('diff', 'Server'), pulledRow('only-server', 'Server only')]

  it('follows every Appendix E row for a snapshot writer', () => {
    expect(actionsOf(local, pulled, true)).toEqual({
      'exercises:only-local': 'pushLocal',
      'exercises:equal': 'same',
      'exercises:diff': 'pushLocal',
      'exercises:only-server': 'keepServer'
    })
  })

  it('follows every Appendix E row for any other browser', () => {
    expect(actionsOf(local, pulled, false)).toEqual({
      'exercises:only-local': 'pushLocal',
      'exercises:equal': 'same',
      'exercises:diff': 'keepServer',
      'exercises:only-server': 'keepServer'
    })
  })
})
