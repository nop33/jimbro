import { account } from './account'
import { fromBase64Url } from './base64url'
import { requestJson, ServerError } from './server'

// Break alerts: a push notification at the end of a break while Jimbro is in the background, where the page itself
// can't ring. The worker keeps this device's push subscription and sends the push (worker/src/breakAlerts.ts), so they
// need cloud backup. The break timer schedules an alert when the page goes out of sight and cancels it when it comes
// back.

const ENABLED_KEY = 'jimbro.breakAlerts'

// Whether this document handed the subscription to the account it backs up to now. Another account's worker may hold
// it, after a switch, or none, after a sign-out, or another device's, after the account moved away and back with the
// same user ID, so each document hands it over once, at its first break, and again after each change of account.
let handedOver = false
account.onChange(() => {
  handedOver = false
})

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
    // Without storage the alerts stay off, which the bell then shows.
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
  handedOver = true
}

// Hands this device's subscription to the account it backs up to now, when alerts are on and this document has not
// yet. A new break calls it while the page is in sight, so the alert it schedules out of sight reaches this device.
export const keepBreakAlertsWithAccount = async () => {
  const current = account.current()
  if (!current || handedOver || !breakAlertsOn()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) {
      // The browser dropped the subscription, so turning alerts on again makes a new one.
      writeEnabled(false)
      return
    }
    await requestJson('/api/break-alerts/subscribe', {
      method: 'POST',
      token: current.token,
      body: subscription.toJSON()
    })
    // A change of account while the request was on its way leaves it to the next break.
    if (account.current()?.token === current.token) handedOver = true
  } catch (error) {
    // The next break tries again.
    console.error('break alerts could not follow the account', error)
  }
}

// Before a sign-out, while the token still works: the account's worker forgets this device. Alerts stay on, for the
// next account this device signs in to.
export const releaseBreakAlerts = async () => {
  const current = account.current()
  if (!current || !readEnabled()) return
  await requestJson('/api/break-alerts/unsubscribe', { method: 'POST', token: current.token }).catch((error: unknown) =>
    console.error('break alerts could not be released', error)
  )
}

// The worker had no subscription to notify, as when the push service said it was gone. Alerts go off on this device,
// with its subscription, so the bell shows them off and turning them on again subscribes afresh.
const lostSubscription = async () => {
  writeEnabled(false)
  handedOver = false
  const registration = await navigator.serviceWorker.getRegistration()
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
}

// Stops the alerts on this device, and tells the worker to forget its subscription when there is an account.
export const disableBreakAlerts = async () => {
  writeEnabled(false)
  handedOver = false
  const registration = await navigator.serviceWorker.getRegistration()
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
  const current = account.current()
  if (current) await requestJson('/api/break-alerts/unsubscribe', { method: 'POST', token: current.token })
}

// Sent as the page goes out of sight, so the request outlives the page's suspension, and nothing waits for it.
const send = async (path: string, body: unknown) => {
  const current = account.current()
  if (!current) return null
  return requestJson(path, { method: 'POST', token: current.token, body, keepalive: true })
}

const unscheduled = (answer: unknown) =>
  typeof answer === 'object' && answer !== null && 'scheduled' in answer && answer.scheduled === false

// Asks the worker for an alert at the end of the break. When it holds no subscription for this device, alerts go off.
export const scheduleBreakAlert = (alert: BreakAlert) =>
  void send('/api/break-alerts/schedule', alert)
    .then(async (answer) => {
      if (unscheduled(answer)) await lostSubscription()
    })
    .catch((error: unknown) => console.error('break alert request failed', error))

export const cancelBreakAlert = () =>
  void send('/api/break-alerts/cancel', {}).catch((error: unknown) =>
    console.error('break alert request failed', error)
  )
