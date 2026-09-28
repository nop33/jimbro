const STORAGE_KEY = 'jimbro.cloudBackup'
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.jimbro.nop33.com'

interface CloudBackupConfig {
  userId: string
  token: string
}

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

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${config.token}`
    }
  })
}
