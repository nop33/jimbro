import type { ExportData } from './types'

// We just parsed a JSON from the network, so we can't trust it at all, thus unknown.
export const validateShape = (data: unknown): data is ExportData => {
  if (typeof data !== 'object' || data === null) return false

  const d = data as Record<string, unknown>

  if (typeof d.version !== 'number') return false
  if (typeof d.exportDate !== 'string') return false
  if (typeof d.stores !== 'object' || d.stores === null) return false

  const stores = d.stores as Record<string, unknown>

  for (const key of ['exercises', 'programs', 'workoutSessions']) {
    const arr = stores[key]
    if (!Array.isArray(arr)) return false
    if (
      arr.some(
        (item: unknown) =>
          typeof item !== 'object' || item === null || typeof (item as Record<string, unknown>).id !== 'string'
      )
    ) {
      return false
    }
  }

  return true
}
