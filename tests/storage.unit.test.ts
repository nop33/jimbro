import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OBJECT_STORES } from '../src/db/constants'
import { Storage } from '../src/db/storage'
import type { Row } from '../src/db/types'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const exercise = (name: string): Row => ({
  table: 'exercises',
  row: {
    id: `exercise-${name}`,
    name,
    kind: 'lifting',
    preset: 'lifting',
    targetSets: 3,
    defaults: { reps: 5 },
    isDeleted: false,
    updatedAt: '2026-11-07T08:00:00.000Z'
  }
})

let storage: Storage

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  storage = new Storage()
})

describe('the shared connection', () => {
  it('opens again when the browser closed it under the page', async () => {
    await storage.writeRows([exercise('Squat')])
    // Closing it by hand leaves the page holding a connection that refuses transactions, as a lost one does.
    ;(await storage.connection()).close()

    await storage.writeRows([exercise('Lunge')])

    const names = (await storage.getAll<{ name: string }>(OBJECT_STORES.EXERCISES)).map((row) => row.name)
    expect(names.sort()).toEqual(['Lunge', 'Squat'])
  })

  it('opens again after the browser reports the connection closed', async () => {
    const first = await storage.connection()
    first.onclose?.call(first, new Event('close'))

    expect(await storage.connection()).not.toBe(first)
  })
})
