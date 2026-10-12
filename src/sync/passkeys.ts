import {
  API_BASE,
  clearCloudBackupConfig,
  fetchJimbroApi,
  getCloudBackupConfig,
  storeCloudBackupConfig
} from '../db/cloudBackup'
import { storage } from '../db/storage'
import { pushLock } from './outbox'
import { restartFirstSync } from './queue'
import { clearLastSyncAt } from './status'
import { sync } from './syncClient'

// A passkey is the account: signing up makes one on the worker, and the phone's password manager (iCloud Keychain,
// Google Password Manager) keeps the passkey and brings it to a new phone, where signing in restores the backup. The
// browser's own WebAuthn API does the ceremony, and the worker checks it. Every function throws when the browser, the
// user or the worker says no, and the page decides what to tell the user.

// Whether this browser can make and use passkeys. Pages hide every passkey button where it cannot.
export const passkeysSupported = () =>
  typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function'

const toBase64Url = (buffer: ArrayBuffer) => {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string) => {
  const binary = atob(
    text
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '=')
  )
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

// The error the worker answered with, such as invalid_challenge, or the status.
export class PasskeyServerError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`passkey request failed: ${code}`)
    this.code = code
  }
}

const answer = async (response: Response) => {
  if (response.ok) return (await response.json()) as unknown
  let code = String(response.status)
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') code = body.error
  } catch {
    // The body was not JSON, so the status stands.
  }
  throw new PasskeyServerError(code)
}

const postPublic = async (path: string, body?: unknown) =>
  answer(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    })
  )

const postSignedIn = async (path: string, body?: unknown) =>
  answer(
    await fetchJimbroApi(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    })
  )

interface CreationOptionsJson {
  challenge: string
  rp: PublicKeyCredentialRpEntity
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: PublicKeyCredentialParameters[]
  authenticatorSelection: AuthenticatorSelectionCriteria
  attestation: AttestationConveyancePreference
  timeout: number
  excludeCredentials: Array<{ type: 'public-key'; id: string }>
}

interface RequestOptionsJson {
  challenge: string
  rpId: string
  userVerification: UserVerificationRequirement
  timeout: number
}

interface Account {
  userId: string
  token: string
}

const isAccount = (value: unknown): value is Account =>
  typeof value === 'object' &&
  value !== null &&
  'userId' in value &&
  'token' in value &&
  typeof value.userId === 'string' &&
  typeof value.token === 'string'

// Makes a passkey for the options the worker gave, and resolves to the registration the worker checks. Attestation is
// 'none', so the worker reads the public key from getPublicKey() and needs no CBOR.
const register = async (options: CreationOptionsJson) => {
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: fromBase64Url(options.challenge),
      user: { ...options.user, id: fromBase64Url(options.user.id) },
      excludeCredentials: options.excludeCredentials.map((excluded) => ({
        type: excluded.type,
        id: fromBase64Url(excluded.id)
      }))
    }
  })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('The browser made no passkey')
  const response = credential.response as AuthenticatorAttestationResponse
  const publicKey = response.getPublicKey()
  if (!publicKey) throw new Error('The passkey uses an algorithm this browser cannot report')
  return {
    id: credential.id,
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.getAuthenticatorData()),
    publicKey: toBase64Url(publicKey),
    publicKeyAlgorithm: response.getPublicKeyAlgorithm()
  }
}

// Saves the account's credentials and has the next sync run a first sync with it, which restores the account's rows
// and pushes every row only this device has. A device that synced with another account, through a token or another
// passkey, leaves that account's backup behind. A sync running with the old credentials finishes first, and the
// switch holds the push lock, so no chunk is on its way to the old account while the credentials change.
const switchTo = async (account: Account) => {
  await sync({ again: false }).catch(() => undefined)
  await pushLock(async () => {
    storeCloudBackupConfig({ ...account, method: 'passkey' })
    clearLastSyncAt()
    await restartFirstSync(storage)
  })
}

// Signs up: makes a new account with a new passkey and backs this device up to it.
export const createPasskeyAccount = async () => {
  const options = (await postPublic('/auth/register/options')) as CreationOptionsJson
  const account = await postPublic('/auth/register/verify', await register(options))
  if (!isAccount(account)) throw new PasskeyServerError('invalid_answer')
  await switchTo(account)
}

// Signs in with any passkey this phone has for Jimbro, which the browser lets the user pick, and restores its account.
export const signInWithPasskey = async () => {
  const options = (await postPublic('/auth/signin/options')) as RequestOptionsJson
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: fromBase64Url(options.challenge),
      rpId: options.rpId,
      allowCredentials: [],
      userVerification: options.userVerification,
      timeout: options.timeout
    }
  })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('The browser used no passkey')
  const response = credential.response as AuthenticatorAssertionResponse
  const account = await postPublic('/auth/signin/verify', {
    id: credential.id,
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.authenticatorData),
    signature: toBase64Url(response.signature)
  })
  if (!isAccount(account)) throw new PasskeyServerError('invalid_answer')
  await switchTo(account)
}

// Adds one more passkey to the signed-in account, such as one in another password manager.
export const addPasskey = async () => {
  const options = (await postSignedIn('/api/passkeys/options')) as CreationOptionsJson
  await postSignedIn('/api/passkeys/verify', await register(options))
}

// Signs out: the worker forgets this device's token, and the device stops syncing. Its data stays on the device.
export const signOut = async () => {
  if (getCloudBackupConfig()) {
    try {
      await postSignedIn('/api/signout')
    } catch (error) {
      // A token the worker no longer knows is signed out already.
      if (!(error instanceof PasskeyServerError && error.code === 'unauthorized')) throw error
    }
  }
  clearCloudBackupConfig()
  clearLastSyncAt()
}
