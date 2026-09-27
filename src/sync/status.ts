const IMPORT_REQUIRED_KEY = 'jimbro.sync.importRequired'
const LAST_SYNC_KEY = 'jimbro.sync.lastAt'

export const markImportRequired = () => localStorage.setItem(IMPORT_REQUIRED_KEY, '1')

export const clearImportRequired = () => localStorage.removeItem(IMPORT_REQUIRED_KEY)

export const isImportRequired = () => localStorage.getItem(IMPORT_REQUIRED_KEY) === '1'

export const setLastSyncAt = (iso: string) => localStorage.setItem(LAST_SYNC_KEY, iso)

export const getLastSyncAt = () => localStorage.getItem(LAST_SYNC_KEY)
