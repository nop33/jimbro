import { formatShortDate } from '../../../dateUtils'
import Toasts from '../../../features/toasts'
import { account } from '../../../sync/account'
import { disconnect, listConnections, MCP_URL, type Connection } from '../../../sync/connections'
import { whileBusy } from '../../busyButton'

// What the user pastes into an assistant, whichever it is, so the assistant sets the connection up itself or says
// where its settings take the link.
export const connectPrompt = (url: string) =>
  `Connect to Jimbro, my workout tracker, so you can answer questions about my workouts. ` +
  `It is a remote MCP server at ${url} (Streamable HTTP, with OAuth sign-in). ` +
  `Add it as a connector or MCP server, or tell me where to add it if I have to do it myself. ` +
  `When it connects, Jimbro opens a page where I approve with my passkey. ` +
  `It can read my exercises, programs and workouts, and can't change them.`

// The AI assistants page: a prompt that connects an assistant such as Claude, and the assistants connected to the
// account, each with Disconnect. An assistant approves with a passkey, so it needs a passkey backup.
export default class AssistantsSetting {
  private needPasskey = document.querySelector('#assistants-need-passkey') as HTMLParagraphElement
  private setup = document.querySelector('#assistants-setup') as HTMLDivElement
  private prompt = document.querySelector('#assistants-prompt') as HTMLTextAreaElement
  private copyBtn = document.querySelector('#assistants-copy') as HTMLButtonElement
  private status = document.querySelector('#assistants-status') as HTMLParagraphElement
  private list = document.querySelector('#assistants-list') as HTMLUListElement
  private item = document.querySelector('#assistant-item') as HTMLTemplateElement

  constructor() {
    this.prompt.value = connectPrompt(MCP_URL)
    this.copyBtn.addEventListener('click', () => void this.copy())
  }

  private hasPasskey() {
    return account.current()?.method === 'passkey'
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(this.prompt.value)
      Toasts.show({ message: 'Prompt copied.' })
    } catch {
      // Without clipboard access, the prompt is selected for the user to copy.
      this.prompt.select()
    }
  }

  // Shows the setup with a passkey backup, and reads the connected assistants from the worker.
  async render() {
    const passkey = this.hasPasskey()
    this.needPasskey.hidden = passkey
    this.setup.hidden = !passkey
    if (!passkey) return
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
    if (!confirm(`Disconnect ${connection.name}? It will need your passkey to connect again.`)) return
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
