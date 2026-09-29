const LAST_SYNC_KEY = 'jimbro.sync.lastAt'

export const setLastSyncAt = (iso: string) => localStorage.setItem(LAST_SYNC_KEY, iso)

export const getLastSyncAt = () => localStorage.getItem(LAST_SYNC_KEY)
