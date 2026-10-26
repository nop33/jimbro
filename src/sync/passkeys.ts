import {
  API_BASE,
  clearCloudBackupConfig,
  fetchJimbroApi,
  getCloudBackupConfig,
  markSignedOut,
  storeCloudBackupConfig
} from '../db/cloudBackup'
import { OBJECT_STORES } from '../db/constants'
import { storage } from '../db/storage'
import { fromBase64Url, toBase64Url } from './base64url'
import { replacesLocalRows } from './bootstrap'
import { outbox, pushLock } from './outbox'
import { pullAll, readFirstSyncSnapshot, type PulledAccount } from './pull'
import { restartFirstSync } from './queue'
import { PULL_LIMIT, type PullPage } from './server'
import { clearLastSyncAt, setSyncProblem } from './status'
import { sync } from './syncClient'

// A passkey is the account: signing up makes one on the worker, and the phone's password manager (iCloud Keychain,
// Google Password Manager) keeps the passkey and brings it to a new phone, where signing in restores the backup. The
// browser's own WebAuthn API does the ceremony, and the worker checks it. Every function throws when the browser, the
// user or the worker says no, and the page decides what to tell the user.

// Whether this browser can make and use passkeys, and report a new one's public key, which the worker needs since it
// parses no attestation. Pages hide every passkey button where it cannot.
export const passkeysSupported = () => {
  if (typeof window.PublicKeyCredential !== 'function' || typeof navigator.credentials?.create !== 'function') {
    return false
  }
  const attestation = window.AuthenticatorAttestationResponse?.prototype
  return (
    typeof attestation?.getPublicKey === 'function' &&
    typeof attestation.getPublicKeyAlgorithm === 'function' &&
    typeof attestation.getAuthenticatorData === 'function'
  )
}

// The error the worker answered with, such as invalid_challenge, or the status.
class PasskeyServerError extends Error {
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

const post = (path: string, body: unknown, token?: string) => {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  }
  if (token === undefined) return fetch(`${API_BASE}${path}`, init)
  return fetch(`${API_BASE}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
}

const postPublic = async (path: string, body?: unknown) => answer(await post(path, body))

const postSignedIn = async (path: string, body?: unknown) =>
  answer(
    await fetchJimbroApi(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    })
  )

// A passkey ceremony: signing up, signing in, or adding a passkey to the signed-in account.
export type Ceremony = 'register' | 'signin' | 'add'

const fetchOptions = (ceremony: Ceremony) => {
  if (ceremony === 'register') return postPublic('/auth/register/options')
  if (ceremony === 'signin') return postPublic('/auth/signin/options')
  return postSignedIn('/api/passkeys/options')
}

// Safari lets a page call navigator.credentials only shortly after the tap, and a fetch on a slow network can outlast
// that. So a page asks for a ceremony's options as it shows the button, and the tap goes straight to the browser's
// passkey sheet. The worker keeps a challenge for 5 minutes, so options count as fresh for 4, and a page that keeps the
// button up fetches new ones before then.
const FRESH_MS = 4 * 60_000

interface Prefetched {
  at: number
  options: Promise<unknown>
  refresh: number
}

const prefetched = new Map<Ceremony, Prefetched>()

// Fetches the ceremony's options now, for a tap to come, and keeps them fresh until signal aborts, as when the page
// with the button goes.
export const preparePasskey = (ceremony: Ceremony, signal?: AbortSignal) => {
  if (signal?.aborted) return
  const previous = prefetched.get(ceremony)
  if (previous) window.clearTimeout(previous.refresh)
  const options = fetchOptions(ceremony)
  const entry: Prefetched = {
    at: Date.now(),
    options,
    refresh: window.setTimeout(() => preparePasskey(ceremony, signal), FRESH_MS)
  }
  signal?.addEventListener(
    'abort',
    () => {
      if (prefetched.get(ceremony) !== entry) return
      window.clearTimeout(entry.refresh)
      prefetched.delete(ceremony)
    },
    { once: true }
  )
  // A failed prefetch leaves the tap to fetch.
  options.catch(() => {
    if (prefetched.get(ceremony) !== entry) return
    window.clearTimeout(entry.refresh)
    prefetched.delete(ceremony)
  })
  prefetched.set(ceremony, entry)
}

// The options for this tap: the prefetched ones while fresh, else fetched now. A challenge is good once, so either way
// they are used up.
const takeOptions = async (ceremony: Ceremony) => {
  const entry = prefetched.get(ceremony)
  prefetched.delete(ceremony)
  if (entry) {
    window.clearTimeout(entry.refresh)
    if (Date.now() - entry.at < FRESH_MS) {
      try {
        return await entry.options
      } catch {
        // The prefetch failed, so the tap fetches.
      }
    }
  }
  return fetchOptions(ceremony)
}

// Runs a ceremony on its options, and prepares new ones when it fails, since the challenge is used up.
const withOptions = async <T>(ceremony: Ceremony, run: (options: unknown) => Promise<T>) => {
  try {
    return await run(await takeOptions(ceremony))
  } catch (error) {
    preparePasskey(ceremony)
    throw error
  }
}

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
  // How many devices a sign-in finds signed in to the account already. A sign-up has none.
  otherDevices?: number
}

const isAccount = (value: unknown): value is Account =>
  typeof value === 'object' &&
  value !== null &&
  'userId' in value &&
  'token' in value &&
  typeof value.userId === 'string' &&
  typeof value.token === 'string' &&
  (!('otherDevices' in value) || typeof value.otherDevices === 'number')

const bytes = (text: string) => {
  const decoded = fromBase64Url(text)
  if (!decoded) throw new PasskeyServerError('invalid_options')
  return decoded
}

// Makes a passkey for the options the worker gave, and resolves to the registration the worker checks. Attestation is
// 'none', so the worker reads the public key from getPublicKey() and needs no CBOR.
const register = async (options: CreationOptionsJson) => {
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: bytes(options.challenge),
      user: { ...options.user, id: bytes(options.user.id) },
      excludeCredentials: options.excludeCredentials.map((excluded) => ({
        type: excluded.type,
        id: bytes(excluded.id)
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
// switch holds the push lock, so no chunk is on its way to the old account while the credentials change. The sync
// state resets before the credentials change, so a switch that stops half way leaves a first sync to run with the old
// account, which only merges again, never a device that skips the first sync with the new one.
const switchTo = async (account: Account) => {
  await sync({ again: false }).catch(() => undefined)
  await pushLock(async () => {
    await restartFirstSync(storage)
    storeCloudBackupConfig({ ...account, method: 'passkey' })
    markSignedOut(false)
    clearLastSyncAt()
    setSyncProblem(null)
  })
}

// Signs up: makes a new account with a new passkey and backs this device up to it. A new account has no rows, so
// nothing on this device is replaced.
export const createPasskeyAccount = async () => {
  const account = await withOptions('register', async (options) =>
    postPublic('/auth/register/verify', await register(options as CreationOptionsJson))
  )
  if (!isAccount(account)) throw new PasskeyServerError('invalid_answer')
  await switchTo(account)
}

// Whether this device holds any exercise, program or workout, which signing in can replace with the account's copy.
const hasLocalRows = async () => {
  for (const store of [OBJECT_STORES.EXERCISES, OBJECT_STORES.PROGRAMS, OBJECT_STORES.WORKOUT_SESSIONS]) {
    if ((await storage.count(store)) > 0) return true
  }
  return false
}

// Every row of the account the token signs in to, as the first sync would pull them.
const pullAccount = (token: string) =>
  pullAll(async (cursor) => {
    const response = await fetch(`${API_BASE}/api/pull?cursor=${cursor}&limit=${PULL_LIMIT}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return (await answer(response)) as PullPage
  })

// Whether signing in to the account would replace any row on this device: one both sides have, with a different copy.
// A phone that signed out after backing up holds the account's own copies, so signing in again replaces nothing.
const signInReplacesLocalRows = async (pulled: PulledAccount) => {
  if (!(await hasLocalRows())) return false
  const local = await readFirstSyncSnapshot(storage)
  return replacesLocalRows(local.rows, pulled.rows)
}

// What a sign-in would do beyond restoring the account, which the page asks about first: move the account here from the
// devices signed in to it, which then stop backing up, and replace rows on this device with the account's copy.
export interface SignInEffects {
  movesFromOtherDevice: boolean
  replacesLocalRows: boolean
}

// Signs in with any passkey this phone has for Jimbro, which the browser lets the user pick, and restores its account.
// An account backs up one device, so signing in claims it, and every other device signed in to it stops backing up.
// The first sync with the account keeps the account's copy of every row both sides have. When the sign-in moves the
// account or replaces a row on this device, confirmSignIn asks first, after the passkey sheet, so the sheet still opens
// right on the tap. Resolves to false when the user said no, and then the device stays as it was, the other devices
// keep backing up, and the worker forgets the new token. The account is downloaded once: the comparison and the
// restore share the pull, so the callers' next sync only pushes.
export const signInWithPasskey = async ({
  confirmSignIn
}: {
  confirmSignIn: (effects: SignInEffects) => boolean | Promise<boolean>
}) => {
  const account = await withOptions('signin', async (options) => {
    const { challenge, rpId, userVerification, timeout } = options as RequestOptionsJson
    const credential = await navigator.credentials.get({
      publicKey: { challenge: bytes(challenge), rpId, allowCredentials: [], userVerification, timeout }
    })
    if (!(credential instanceof PublicKeyCredential)) throw new Error('The browser used no passkey')
    const response = credential.response as AuthenticatorAssertionResponse
    return postPublic('/auth/signin/verify', {
      id: credential.id,
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature)
    })
  })
  if (!isAccount(account)) throw new PasskeyServerError('invalid_answer')
  const forget = async () => {
    await post('/api/signout', {}, account.token).catch(() => undefined)
    preparePasskey('signin')
  }
  const pulled = await pullAccount(account.token)
  const effects: SignInEffects = {
    movesFromOtherDevice: (account.otherDevices ?? 0) > 0,
    replacesLocalRows: await signInReplacesLocalRows(pulled)
  }
  if ((effects.movesFromOtherDevice || effects.replacesLocalRows) && !(await confirmSignIn(effects))) {
    await forget()
    return false
  }
  // The other devices are signed out before this one switches, so a failed claim leaves everything as it was.
  try {
    await answer(await post('/api/claim', {}, account.token))
  } catch (error) {
    await forget()
    throw error
  }
  await switchTo(account)
  // A failed restore leaves the first sync to the callers' next sync, which pulls again.
  await sync({ again: false, restoring: pulled }).catch(() => undefined)
  return true
}

// Adds one more passkey to the signed-in account, such as one in another password manager.
export const addPasskey = async () => {
  await withOptions('add', async (options) =>
    postSignedIn('/api/passkeys/verify', await register(options as CreationOptionsJson))
  )
  preparePasskey('add')
}

// Before a sign-out: pushes what waits, and resolves to the rows still not backed up, which a sign-out would leave out
// of the backup. Signing in again later keeps the backup's copy of each of them.
export const backUpBeforeSignOut = async () => {
  await sync({ again: false }).catch(() => undefined)
  return outbox.pending()
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
  markSignedOut(true)
  clearLastSyncAt()
  setSyncProblem(null)
}
