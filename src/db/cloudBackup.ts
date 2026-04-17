import Toasts from '../features/toasts'
import { buildExportData, type ExportData } from './export'

const STORAGE_KEY = 'jimbro.cloudBackup'
const API_BASE = 'https://api.jimbro.nop33.com'

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
  } catch (error) {
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

export const uploadToCloud = async (data?: ExportData) => {
  const payload = data ?? (await buildExportData())

  const res = await fetchJimbroApi('/api/snapshot', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (res.status === 409) {
    const body = await res.json()
    return Toasts.show({
      message: `Backup rejected: ${body.rule}. Previous backup had ${body.previous.exercises} exercises and ${body.previous.workoutSessions} workout sessions, but attempted backup has only ${body.incoming.exercises} exercises and ${body.incoming.workoutSessions} workout sessions.`,
      type: 'warning',
      duration: 'long'
    })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Upload failed: ${res.status}`)
  }
}

export const restoreFromCloud = async (): Promise<Response> => {
  const res = await fetchJimbroApi('/api/snapshot/latest')

  if (res.status === 404) {
    throw new Error('No backup found on the cloud')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Restore failed: ${res.status}`)
  }

  return res
}
