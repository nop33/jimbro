import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { autoExportDue, readLastExportAt, recordExport } from '../src/pages/gymtime/autoExport'

const NOW = new Date('2026-10-31T18:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const due = (overrides: Partial<Parameters<typeof autoExportDue>[0]> = {}) =>
  autoExportDue({ backedUp: false, lastExportAt: null, now: NOW, ...overrides })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('autoExportDue', () => {
  it('exports the first finished workout on a device without backup', () => {
    expect(due()).toBe(true)
  })

  it('never exports on a device that backs up to the cloud', () => {
    expect(due({ backedUp: true })).toBe(false)
  })

  it('exports again only a week after the last export', () => {
    expect(due({ lastExportAt: daysAgo(1) })).toBe(false)
    expect(due({ lastExportAt: daysAgo(6.9) })).toBe(false)
    expect(due({ lastExportAt: daysAgo(7) })).toBe(true)
  })

  it('exports when the stored time is unreadable', () => {
    expect(due({ lastExportAt: 'garbage' })).toBe(true)
  })
})

describe('the last export time', () => {
  it('reads back what was recorded', () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value)
    })
    expect(readLastExportAt()).toBeNull()
    recordExport(NOW)
    expect(readLastExportAt()).toBe(NOW.toISOString())
  })

  it('reads nothing and records nothing when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    })
    expect(readLastExportAt()).toBeNull()
    expect(() => recordExport(NOW)).not.toThrow()
  })
})
