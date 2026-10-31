const LAST_EXPORT_KEY = 'jimbro.autoExport.lastAt'
const EXPORT_EVERY_DAYS = 7

// Whether a finished workout downloads a JSON export: only without cloud backup, since then the export is the only copy
// outside this browser, and at most once a week, so the download sheet doesn't cover the celebration every session.
export const autoExportDue = ({
  backedUp,
  lastExportAt,
  now
}: {
  backedUp: boolean
  lastExportAt: string | null
  now: Date
}) => {
  if (backedUp) return false
  const last = lastExportAt === null ? Number.NaN : Date.parse(lastExportAt)
  return Number.isNaN(last) || now.getTime() - last >= EXPORT_EVERY_DAYS * 86_400_000
}

// When the last automatic export downloaded, or null. localStorage can be missing or throw, as in a private window, and
// then every finished workout exports, as before.
export const readLastExportAt = (): string | null => {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY)
  } catch {
    return null
  }
}

export const recordExport = (now: Date) => {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, now.toISOString())
  } catch {
    // Without storage the next finished workout exports again, which is all that is lost.
  }
}
