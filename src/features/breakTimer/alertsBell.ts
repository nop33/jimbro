import { account } from '../../sync/account'
import {
  BreakAlertsUnavailable,
  breakAlertsOn,
  breakAlertsSupported,
  disableBreakAlerts,
  enableBreakAlerts
} from '../../sync/breakAlerts'
import { alertsOfferDue, readOfferSnoozedUntil, snoozeAlertsOffer } from './alertsOffer'

const UNAVAILABLE = {
  blocked: 'Notifications are blocked for Jimbro. Allow them in your phone’s settings, then try again.',
  not_configured: 'Break alerts aren’t set up on the server yet.',
  no_account: 'Break alerts need cloud backup. Set it up in Settings first.'
} as const

// Break alerts on the full break timer: a notification when a break ends with Jimbro in the background. The bell at
// the top turns them on and off, and is struck through while they are off. While they are off, a break also offers
// them, until "Not now". Turning them on asks for permission to notify, which browsers allow only from a tap, so they
// can't be on by default. Both show only where the browser has push, which on an iPhone means the app added to the
// Home Screen. The timer is a modal, over any toast, so the bell says what happened in the line under it.
export default class AlertsBell {
  private button: HTMLButtonElement
  private message: HTMLParagraphElement
  private offer: HTMLDivElement
  private supported = breakAlertsSupported()

  constructor(dialog: HTMLDialogElement) {
    this.button = dialog.querySelector('#break-alerts-bell') as HTMLButtonElement
    this.message = dialog.querySelector('#break-alerts-message') as HTMLParagraphElement
    this.offer = dialog.querySelector('#break-alerts-offer') as HTMLDivElement
    if (!this.supported) return
    this.button.hidden = false
    this.button.addEventListener('click', () => void this.flip())
    dialog.querySelector('#break-alerts-offer-on')?.addEventListener('click', () => void this.flip())
    dialog.querySelector('#break-alerts-offer-later')?.addEventListener('click', () => {
      snoozeAlertsOffer(new Date())
      this.offer.hidden = true
    })
  }

  // A new break: the bell shows whether the alerts are on, and the offer shows when it is due.
  reset() {
    this.message.textContent = ''
    this.render()
    this.offer.hidden = !alertsOfferDue({
      supported: this.supported,
      hasAccount: account.current() !== null,
      on: breakAlertsOn(),
      permission: this.supported ? Notification.permission : 'default',
      snoozedUntil: readOfferSnoozedUntil(),
      now: new Date()
    })
  }

  private render() {
    const on = breakAlertsOn()
    this.button.setAttribute('aria-pressed', String(on))
    this.button.title = on ? 'Break alerts on' : 'Break alerts off'
  }

  private async flip() {
    if (this.button.getAttribute('aria-busy') === 'true') return
    const turningOn = !breakAlertsOn()
    this.message.textContent = ''
    if (turningOn && account.current() === null) {
      this.message.textContent = UNAVAILABLE.no_account
      return
    }
    this.button.setAttribute('aria-busy', 'true')
    try {
      await (turningOn ? enableBreakAlerts() : disableBreakAlerts())
      this.message.textContent = turningOn ? 'Break alerts on.' : 'Break alerts off.'
      this.offer.hidden = true
      if (!turningOn) snoozeAlertsOffer(new Date(), 365)
    } catch (error) {
      console.error('break alerts failed', error)
      this.message.textContent =
        error instanceof BreakAlertsUnavailable
          ? UNAVAILABLE[error.reason]
          : 'Could not change break alerts. Try again.'
    } finally {
      this.button.removeAttribute('aria-busy')
      this.render()
    }
  }
}
