import { account } from './account'
import { fromBase64Url } from './base64url'
import { requestJson, ServerError } from './server'

// Break alerts: a push notification at the end of a break while Jimbro is in the background, where the page itself
// can't ring. The worker keeps this device's push subscription and sends the push (worker/src/breakAlerts.ts), so they
// need cloud backup. The break timer schedules an alert when the page goes out of sight and cancels it when it comes
// back.

const ENABLED_KEY = 'jimbro.breakAlerts'

export interface BreakAlert {
  endsAt: number
  title: string
  body: string
  url: string
}

// Whether this browser can take push notifications. An iPhone has them only in the app added to the Home Screen.
export const breakAlertsSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const readEnabled = () => {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'on'
  } catch {
    return false
  }
}

const writeEnabled = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, 'on')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // Without storage the alerts stay off, which the Settings toggle then shows.
  }
}

// Whether a break that goes out of sight is announced: the user turned alerts on, still allows notifications, and
// backs up to an account.
export const breakAlertsOn = () =>
  breakAlertsSupported() && readEnabled() && Notification.permission === 'granted' && account.current() !== null

// Why break alerts can't be turned on: the browser blocks notifications for the app, the worker has no keys for them,
// or the device has no account. The page words each.
export class BreakAlertsUnavailable extends Error {
  readonly reason: 'blocked' | 'not_configured' | 'no_account'

  constructor(reason: BreakAlertsUnavailable['reason']) {
    super(`break alerts unavailable: ${reason}`)
    this.reason = reason
  }
}

// Asks for permission to notify, subscribes this device's service worker to push, and hands the subscription to the
// worker. Call it from a tap, since browsers ask for permission only then.
export const enableBreakAlerts = async () => {
  const current = account.current()
  if (!current) throw new BreakAlertsUnavailable('no_account')
  if ((await Notification.requestPermission()) !== 'granted') throw new BreakAlertsUnavailable('blocked')
  let publicKey: string
  try {
    ;({ publicKey } = (await requestJson('/api/break-alerts', { token: current.token })) as { publicKey: string })
  } catch (error) {
    if (error instanceof ServerError && error.code === 'not_configured') {
      throw new BreakAlertsUnavailable('not_configured')
    }
    throw error
  }
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(publicKey)
    }))
  await requestJson('/api/break-alerts/subscribe', {
    method: 'POST',
    token: current.token,
    body: subscription.toJSON()
  })
  writeEnabled(true)
}

// Stops the alerts on this device, and tells the worker to forget its subscription when there is an account.
export const disableBreakAlerts = async () => {
  writeEnabled(false)
  const registration = await navigator.serviceWorker.getRegistration()
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
  const current = account.current()
  if (current) await requestJson('/api/break-alerts/unsubscribe', { method: 'POST', token: current.token })
}

// Sent as the page goes out of sight, so the request outlives the page's suspension, and nothing waits for it.
const send = (path: string, body: unknown) => {
  const current = account.current()
  if (!current) return
  void requestJson(path, { method: 'POST', token: current.token, body, keepalive: true }).catch((error: unknown) =>
    console.error('break alert request failed', error)
  )
}

export const scheduleBreakAlert = (alert: BreakAlert) => send('/api/break-alerts/schedule', alert)

export const cancelBreakAlert = () => send('/api/break-alerts/cancel', {})
