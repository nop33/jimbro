import { readConnectRequest, denyConnection } from '../../sync/connections'
import { approveConnection, passkeysSupported, preparePasskey } from '../../sync/passkeys'
import { whileBusy } from '../busyButton'
import { showPasskeyFailure } from '../passkeyPrompts'
import Toasts from '../../features/toasts'

// The page an AI assistant sends the browser to when it asks to read the account: it says who asks and where the
// browser goes back to, and the user approves with a passkey or says no. Either way the browser goes back to the
// assistant. The device that backs up keeps its own sign-in, since approving makes no device token.
export default class ConnectPage {
  private signal: AbortSignal
  private loading = document.querySelector('#connect-loading') as HTMLParagraphElement
  private ask = document.querySelector('#connect-ask') as HTMLElement
  private client = document.querySelector('#connect-client') as HTMLSpanElement
  private host = document.querySelector('#connect-host') as HTMLElement
  private local = document.querySelector('#connect-local') as HTMLParagraphElement
  private allowBtn = document.querySelector('#connect-allow') as HTMLButtonElement
  private denyBtn = document.querySelector('#connect-deny') as HTMLButtonElement
  private gone = document.querySelector('#connect-gone') as HTMLElement
  private unsupported = document.querySelector('#connect-unsupported') as HTMLElement
  private failed = document.querySelector('#connect-failed') as HTMLParagraphElement
  private request = ''

  constructor(signal: AbortSignal) {
    this.signal = signal
    this.allowBtn.addEventListener('click', () => void this.allow())
    this.denyBtn.addEventListener('click', () => void this.deny())
  }

  async show(request: string) {
    this.request = request
    if (!passkeysSupported()) {
      this.settle(this.unsupported)
      return
    }
    try {
      const asked = request === '' ? null : await readConnectRequest(request)
      if (!asked) {
        this.settle(this.gone)
        return
      }
      this.client.textContent = asked.clientName
      this.host.textContent = asked.redirectHost
      this.local.hidden = !asked.onThisComputer
      // The tap goes straight to the passkey sheet, as Safari needs.
      preparePasskey('connect', this.signal)
      this.settle(this.ask)
    } catch (error) {
      console.error('loading the connect request failed', error)
      this.settle(this.failed)
    }
  }

  private settle(shown: HTMLElement) {
    this.loading.hidden = true
    for (const section of [this.ask, this.gone, this.unsupported, this.failed]) section.hidden = section !== shown
  }

  private async allow() {
    let redirect: string
    try {
      redirect = await whileBusy(this.allowBtn, 'Connecting…', () => approveConnection(this.request), [this.denyBtn])
    } catch (error) {
      showPasskeyFailure(error)
      return
    }
    this.leaveFor(redirect)
  }

  private async deny() {
    let redirect: string
    try {
      redirect = await whileBusy(this.denyBtn, 'Cancelling…', () => denyConnection(this.request), [this.allowBtn])
    } catch (error) {
      console.error('turning the connection down failed', error)
      Toasts.show({ message: 'Could not cancel. Try again.', type: 'error' })
      return
    }
    this.leaveFor(redirect)
  }

  // Back to the assistant, which may be on another site or on this computer. The buttons stay off on the way.
  private leaveFor(redirect: string) {
    this.allowBtn.disabled = true
    this.denyBtn.disabled = true
    location.assign(redirect)
  }
}
