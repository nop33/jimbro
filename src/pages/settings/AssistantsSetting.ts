import { formatShortDate } from '../../dateUtils'
import Toasts from '../../features/toasts'
import { account } from '../../sync/account'
import { disconnect, listConnections, MCP_URL, type Connection } from '../../sync/connections'
import { whileBusy } from '../busyButton'

// AI Assistants: the link an assistant such as Claude connects with, and the assistants connected to the account,
// each with Disconnect. An assistant approves with a passkey, so it needs a passkey backup.
export default class AssistantsSetting {
  private details = document.querySelector('#assistants-details') as HTMLDetailsElement
  private needPasskey = document.querySelector('#assistants-need-passkey') as HTMLParagraphElement
  private setup = document.querySelector('#assistants-setup') as HTMLDivElement
  private url = document.querySelector('#assistants-url') as HTMLInputElement
  private copyBtn = document.querySelector('#assistants-copy') as HTMLButtonElement
  private status = document.querySelector('#assistants-status') as HTMLParagraphElement
  private list = document.querySelector('#assistants-list') as HTMLUListElement
  private item = document.querySelector('#assistant-item') as HTMLTemplateElement

  constructor() {
    this.url.value = MCP_URL
    this.copyBtn.addEventListener('click', () => void this.copy())
    // The list is read from the worker when the section opens.
    this.details.addEventListener('toggle', () => {
      if (this.details.open) void this.render()
    })
    this.showState()
  }

  private hasPasskey() {
    return account.current()?.method === 'passkey'
  }

  private showState() {
    const passkey = this.hasPasskey()
    this.needPasskey.hidden = passkey
    this.setup.hidden = !passkey
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      Toasts.show({ message: 'Link copied.' })
    } catch {
      // Without clipboard access, the link is selected for the user to copy.
      this.url.select()
    }
  }

  private async render() {
    this.showState()
    if (!this.hasPasskey()) return
    this.status.textContent = 'Loading…'
    let connections: Connection[]
    try {
      connections = await listConnections()
    } catch (error) {
      console.error('loading the assistants failed', error)
      this.status.textContent = 'Could not load the connected assistants. Check your connection.'
      this.list.replaceChildren()
      return
    }
    this.status.textContent = connections.length === 0 ? 'No assistant is connected yet.' : ''
    this.list.replaceChildren(...connections.map((connection) => this.itemFor(connection)))
  }

  private itemFor(connection: Connection) {
    const item = this.item.content.firstElementChild?.cloneNode(true) as HTMLLIElement
    ;(item.querySelector('.assistant-name') as HTMLElement).textContent = connection.name
    ;(item.querySelector('.assistant-used') as HTMLElement).textContent =
      `Connected ${formatShortDate(new Date(connection.connectedAt))} · last used ${formatShortDate(new Date(connection.lastUsedAt))}`
    const button = item.querySelector('.assistant-disconnect') as HTMLButtonElement
    button.setAttribute('aria-label', `Disconnect ${connection.name}`)
    button.addEventListener('click', () => void this.disconnect(connection, button))
    return item
  }

  private async disconnect(connection: Connection, button: HTMLButtonElement) {
    try {
      await whileBusy(button, 'Disconnecting…', () => disconnect(connection.id))
    } catch (error) {
      console.error('disconnecting failed', error)
      Toasts.show({ message: 'Could not disconnect. Try again when online.', type: 'error' })
      return
    }
    Toasts.show({ message: `${connection.name} disconnected.` })
    await this.render()
  }
}
