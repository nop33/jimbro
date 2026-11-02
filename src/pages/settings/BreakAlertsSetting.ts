import Toasts from '../../features/toasts'
import { account } from '../../sync/account'
import {
  BreakAlertsUnavailable,
  breakAlertsOn,
  breakAlertsSupported,
  disableBreakAlerts,
  enableBreakAlerts
} from '../../sync/breakAlerts'
import { whileBusy } from '../busyButton'

const UNAVAILABLE = {
  blocked: 'Notifications are blocked for Jimbro. Allow them in your phone’s settings, then try again.',
  not_configured: 'Break alerts aren’t set up on the server yet.',
  no_account: 'Break alerts need cloud backup. Set it up below first.'
} as const

// The Break Alerts setting under Workout Settings: a notification when a break ends with Jimbro in the background.
// It shows only where the browser has push, which on an iPhone means the app added to the Home Screen.
export default class BreakAlertsSetting {
  private section = document.querySelector('#break-alerts') as HTMLDivElement
  private status = document.querySelector('#break-alerts-status') as HTMLParagraphElement
  private toggle = document.querySelector('#break-alerts-toggle') as HTMLButtonElement

  constructor() {
    if (!breakAlertsSupported()) return
    this.section.hidden = false
    this.toggle.addEventListener('click', () => void this.flip())
    this.render()
  }

  private render() {
    const on = breakAlertsOn()
    const hasAccount = account.current() !== null
    this.status.textContent = on
      ? 'On. When a break ends with Jimbro in the background, this phone gets a notification.'
      : hasAccount
        ? 'Get a notification when a break ends with Jimbro in the background or the phone locked.'
        : UNAVAILABLE.no_account
    this.toggle.textContent = on ? 'Turn off break alerts' : 'Turn on break alerts'
    this.toggle.disabled = !on && !hasAccount
  }

  private async flip() {
    const turningOn = !breakAlertsOn()
    try {
      await whileBusy(this.toggle, turningOn ? 'Turning on…' : 'Turning off…', () =>
        turningOn ? enableBreakAlerts() : disableBreakAlerts()
      )
      Toasts.show({ message: turningOn ? 'Break alerts on.' : 'Break alerts off.' })
    } catch (error) {
      console.error('break alerts failed', error)
      const message =
        error instanceof BreakAlertsUnavailable
          ? UNAVAILABLE[error.reason]
          : 'Could not change break alerts. Try again.'
      Toasts.show({ message, type: 'error' })
    }
    this.render()
  }
}
