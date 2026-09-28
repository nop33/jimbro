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

describe('planBootstrap', () => {
  it('pushes rows only the browser has and keeps the server row everywhere else', () => {
    const local = [localRow('only-local', 'Local only'), localRow('equal', 'Same'), localRow('diff', 'Phone')]
    const pulled = [pulledRow('equal', 'Same'), pulledRow('diff', 'Server'), pulledRow('only-server', 'Server only')]
    expect(Object.fromEntries(planBootstrap(local, pulled))).toEqual({
      'exercises:only-local': 'pushLocal',
      'exercises:equal': 'same',
      'exercises:diff': 'keepServer',
      'exercises:only-server': 'keepServer'
    })
  })
})
