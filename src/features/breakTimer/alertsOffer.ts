const SNOOZE_KEY = 'jimbro.breakAlertsOffer.snoozedUntil'
const SNOOZE_DAYS = 14

// Whether a break offers to turn break alerts on: where the browser has push, with an account to send them, while they
// are off and the browser hasn't blocked notifications for good, and not during the 14 days after "Not now".
export const alertsOfferDue = ({
  supported,
  hasAccount,
  on,
  permission,
  snoozedUntil,
  now
}: {
  supported: boolean
  hasAccount: boolean
  on: boolean
  permission: NotificationPermission
  snoozedUntil: string | null
  now: Date
}) => {
  if (!supported || !hasAccount || on || permission === 'denied') return false
  const until = snoozedUntil === null ? Number.NaN : Date.parse(snoozedUntil)
  return Number.isNaN(until) || now.getTime() >= until
}

// The end of the snooze, or null. localStorage can be missing or throw, as in a private window, and then nothing is
// snoozed.
export const readOfferSnoozedUntil = (): string | null => {
  try {
    return localStorage.getItem(SNOOZE_KEY)
  } catch {
    return null
  }
}

// "Not now": the offer stays away for SNOOZE_DAYS. Turning the alerts off with the bell keeps it away for a year, since
// that was a choice. The bell still turns them on.
export const snoozeAlertsOffer = (now: Date, days = SNOOZE_DAYS) => {
  try {
    localStorage.setItem(SNOOZE_KEY, new Date(now.getTime() + days * 86_400_000).toISOString())
  } catch {
    // Without storage the offer comes back with the next break, which is all that is lost.
  }
}
