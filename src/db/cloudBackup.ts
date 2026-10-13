const STORAGE_KEY = 'jimbro.cloudBackup'
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.jimbro.nop33.com'

// How the credentials came: a passkey sign-up or sign-in, or a user ID and token typed into Settings (for local runs,
// tests and MCP). Credentials saved before passkeys existed carry no method, and count as a token.
export const CLOUD_BACKUP_METHODS = ['passkey', 'token'] as const
export type CloudBackupMethod = (typeof CLOUD_BACKUP_METHODS)[number]

export interface CloudBackupConfig {
  userId: string
  token: string
  method: CloudBackupMethod
}

export const getCloudBackupConfig = (): CloudBackupConfig | null => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const config = JSON.parse(raw)
    if (typeof config.userId !== 'string' || typeof config.token !== 'string') return null
    if (!config.userId || !config.token) return null
    return { userId: config.userId, token: config.token, method: config.method === 'passkey' ? 'passkey' : 'token' }
  } catch {
    return null
  }
}

export const storeCloudBackupConfig = (config: CloudBackupConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export const clearCloudBackupConfig = () => {
  localStorage.removeItem(STORAGE_KEY)
}

const SIGNED_OUT_KEY = 'jimbro.cloudBackup.signedOut'

// Whether this device signed out of a passkey account, so Settings offers signing in first. Like the rest of the
// credentials it lives in localStorage, and a storage that throws only loses the hint.
export const markSignedOut = (signedOut: boolean) => {
  try {
    if (signedOut) localStorage.setItem(SIGNED_OUT_KEY, '1')
    else localStorage.removeItem(SIGNED_OUT_KEY)
  } catch {
    // Settings then offers creating a passkey first, as on a new device.
  }
}

export const wasSignedOut = () => {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === '1'
  } catch {
    return false
  }
}

export const fetchJimbroApi = async (path: string, options: RequestInit = {}) => {
  const config = getCloudBackupConfig()
  if (!config) throw new Error('Cloud backup not configured')

  // Headers reads every form of HeadersInit. Spreading a Headers object or an array of pairs would lose them.
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${config.token}`)
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}
