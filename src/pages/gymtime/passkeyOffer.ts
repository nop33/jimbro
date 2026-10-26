import type { CloudBackupMethod } from '../../db/cloudBackup'

const SNOOZE_KEY = 'jimbro.passkeyOffer.snoozedUntil'
const SNOOZE_DAYS = 14

// Whether a finished workout offers a passkey: only where the browser has passkeys, while no passkey backs this device
// up (no backup, or a typed token), and not during the 14 days after "Not now".
export const passkeyOfferDue = ({
  backup,
  supported,
  snoozedUntil,
  now
}: {
  backup: CloudBackupMethod | null
  supported: boolean
  snoozedUntil: string | null
  now: Date
}) => {
  if (backup === 'passkey' || !supported) return false
  const until = snoozedUntil === null ? Number.NaN : Date.parse(snoozedUntil)
  return Number.isNaN(until) || now.getTime() >= until
}

// The end of the snooze, or null. localStorage can be missing or throw, as in a private window, and then nothing is
// snoozed.
export const readSnoozedUntil = (): string | null => {
  try {
    return localStorage.getItem(SNOOZE_KEY)
  } catch {
    return null
  }
}

// "Not now": the offer stays away for SNOOZE_DAYS.
export const snoozePasskeyOffer = (now: Date) => {
  try {
    localStorage.setItem(SNOOZE_KEY, new Date(now.getTime() + SNOOZE_DAYS * 86_400_000).toISOString())
  } catch {
    // Without storage the offer comes back after the next workout, which is all that is lost.
  }
}
