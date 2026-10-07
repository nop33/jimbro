const STORAGE_KEY = 'jimbro.cloudBackup'
const LAST_BACKUP_KEY = 'jimbro.cloudBackup.lastDate'
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.jimbro.nop33.com'

interface CloudBackupConfig {
  userId: string
  token: string
}

export const getLastBackupDate = (): string | null => localStorage.getItem(LAST_BACKUP_KEY)

export const getCloudBackupConfig = (): CloudBackupConfig | null => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const config = JSON.parse(raw)
    if (config.userId && config.token) return config
    return null
  } catch {
    return null
  }
}

export const storeCloudBackupConfig = (config: CloudBackupConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export const fetchJimbroApi = async (path: string, options: RequestInit = {}) => {
  const config = getCloudBackupConfig()
  if (!config) throw new Error('Cloud backup not configured')

  // Headers reads every form of HeadersInit. Spreading a Headers object or an array of pairs would lose them.
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${config.token}`)
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}
