import { account } from './account'
import { isRedirect } from './passkeys'
import { API_BASE, requestJson, ServerError } from './server'

// AI assistants that read the account through the worker's MCP server. An assistant connects over OAuth: the worker
// sends its request to the /connect/ page, which approves it with a passkey (approveConnection in passkeys.ts) or
// turns it down. Settings lists the connected ones, and Disconnect ends one.

// The link an assistant connects with.
export const MCP_URL = `${API_BASE}/mcp`

// What the /connect/ page shows about a request: the name the assistant gave, and the host the browser goes back to,
// which tells a real assistant from one only using its name.
export interface ConnectRequest {
  clientName: string
  redirectHost: string
  // The assistant runs on this computer, such as a desktop app or a command line tool.
  onThisComputer: boolean
}

const isConnectRequest = (value: unknown): value is ConnectRequest =>
  typeof value === 'object' &&
  value !== null &&
  'clientName' in value &&
  'redirectHost' in value &&
  'onThisComputer' in value &&
  typeof value.clientName === 'string' &&
  typeof value.redirectHost === 'string' &&
  typeof value.onThisComputer === 'boolean'

// The request waiting for an answer, or null when it is unknown, answered or expired.
export const readConnectRequest = async (request: string): Promise<ConnectRequest | null> => {
  try {
    const answer = await requestJson('/auth/connect/request', { method: 'POST', body: { request } })
    if (!isConnectRequest(answer)) throw new ServerError(200, 'invalid_answer')
    return answer
  } catch (error) {
    if (error instanceof ServerError && error.code === 'unknown_request') return null
    throw error
  }
}

// Turns the request down, and resolves to the URL that tells the assistant so.
export const denyConnection = async (request: string) => {
  const answer = await requestJson('/auth/connect/deny', { method: 'POST', body: { request } })
  if (!isRedirect(answer)) throw new ServerError(200, 'invalid_answer')
  return answer.redirect
}

// An assistant connected to the account. The times are ISO strings.
export interface Connection {
  id: string
  name: string
  connectedAt: string
  lastUsedAt: string
}

const isConnection = (value: unknown): value is Connection =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'name' in value &&
  'connectedAt' in value &&
  'lastUsedAt' in value &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.connectedAt === 'string' &&
  typeof value.lastUsedAt === 'string'

const signedInToken = () => {
  const saved = account.current()
  if (!saved) throw new Error('No account is saved')
  return saved.token
}

// The assistants connected to the account this device backs up to.
export const listConnections = async (): Promise<Connection[]> => {
  const answer = await requestJson('/api/connections', { token: signedInToken() })
  const connections =
    typeof answer === 'object' && answer !== null && 'connections' in answer ? answer.connections : undefined
  if (!Array.isArray(connections) || !connections.every(isConnection)) throw new ServerError(200, 'invalid_answer')
  return connections
}

// Ends a connection: the assistant's next call is refused.
export const disconnect = async (id: string) => {
  await requestJson('/api/connections/revoke', { method: 'POST', token: signedInToken(), body: { id } })
}
