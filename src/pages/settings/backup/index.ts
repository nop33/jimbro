import CloudBackup from './CloudBackup'

export const mount = async (signal: AbortSignal) => {
  await new CloudBackup(signal).showStatus()
}
