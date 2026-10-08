import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vite-plus/test'
import { workoutSessionsStore } from '../src/db/stores/workoutSessionsStore'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const start = (date: string, location: string) =>
  workoutSessionsStore.create({ date, programId: 'program', location, notes: '', exercises: [] })

describe('gyms', () => {
  it('lists each named gym once, the most recently used first, and renames or merges them', async () => {
    await start('2026-09-01', 'Athens')
    await start('2026-09-03', 'Holmes Place Syntagma')
    await start('2026-09-05', 'Athens ')
    await start('2026-09-07', '')
    const deleted = await start('2026-09-09', 'Hotel gym')
    await workoutSessionsStore.remove(deleted.id)

    expect(await workoutSessionsStore.getGyms()).toEqual([
      { name: 'Athens', sessions: 2 },
      { name: 'Holmes Place Syntagma', sessions: 1 }
    ])

    expect(await workoutSessionsStore.renameGym('Athens', ' Holmes Place Syntagma ')).toBe(2)
    expect(await workoutSessionsStore.getGyms()).toEqual([{ name: 'Holmes Place Syntagma', sessions: 3 }])

    await expect(workoutSessionsStore.renameGym('Holmes Place Syntagma', '  ')).rejects.toThrow('needs a name')
  })
})
