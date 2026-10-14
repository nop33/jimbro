import { storage as appStorage, type Storage } from '../db/storage'
import { pushLock, type PushLock } from './outbox'
import { restartFirstSync } from './queue'
import { ServerError } from './server'

// The account this device backs up to: a user ID and token from a passkey sign-up or sign-in, or typed into Settings
// for local runs, tests and MCP. Credentials saved before passkeys existed carry no method, and count as a token.
export const ACCOUNT_METHODS = ['passkey', 'token'] as const
export type AccountMethod = (typeof ACCOUNT_METHODS)[number]

export interface Account {
  userId: string
  token: string
  method: AccountMethod
}

// A problem a retry cannot fix, which the app shows until a sync succeeds: row_limit, when the account holds as many
// rows as the worker takes for one account.
export type SyncProblem = 'row_limit'

export interface AccountStatus {
  lastSyncAt: string | null
  problem: SyncProblem | null
}

// The keys the account keeps in localStorage. They never change, so a device stays signed in across updates.
const KEYS = {
  account: 'jimbro.cloudBackup',
  signedOut: 'jimbro.cloudBackup.signedOut',
  lastSyncAt: 'jimbro.sync.lastAt',
  problem: 'jimbro.sync.problem'
} as const

// The part of localStorage the account needs, so the unit tests can pass a Map.
export type KeyValue = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

// The one owner of which account this device syncs with. Every change of account goes through switchTo or signOut,
// which reset the sync state and the status together, and every sync runs inside use, so it talks to one account from
// start to end.
export interface Accounts {
  // The account saved now, or null while the device has none.
  current(): Account | null
  // Runs the task with the account saved when it starts, and resolves to its result, or to null without running it
  // while there is none. A switch or sign-out waits for every running task, and a task waits for a switch in progress.
  use<T>(task: (account: Account) => Promise<T>): Promise<T | null>
  // Backs this device up to the account from now on: the next sync is a first sync with it, which restores its rows
  // and pushes it every row only this device has. A device that synced with another account leaves that one behind.
  // Saving the same account again only merges again.
  switchTo(account: Account): Promise<void>
  // Forgets the account, so the device stops syncing, and remembers the sign-out so Settings offers signing in first.
  // The device's data stays. Telling the worker to forget the token is the caller's job, before this.
  signOut(): Promise<void>
  // Whether this device signed out of an account and has not saved one since.
  signedOut(): boolean
  // When the last sync succeeded, and the problem the last failed one hit, for the account saved now.
  status(): AccountStatus
  // The sync engine reports each run's outcome here, from inside use.
  synced(at: string): void
  failed(error: unknown): void
}

const parseAccount = (raw: string | null): Account | null => {
  if (!raw) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (typeof saved !== 'object' || saved === null) return null
    const { userId, token, method } = saved as Record<string, unknown>
    if (typeof userId !== 'string' || typeof token !== 'string' || !userId || !token) return null
    return { userId, token, method: method === 'passkey' ? 'passkey' : 'token' }
  } catch {
    return null
  }
}

export const createAccounts = (deps: { storage: Storage; lock: PushLock; local: () => KeyValue }): Accounts => {
  const { storage, lock, local } = deps

  // localStorage can throw, in a private window or with storage blocked. Losing a hint or the status is fine.
  const quietly = (task: () => void) => {
    try {
      task()
    } catch {
      // The value stays as it was.
    }
  }
  const read = (key: string) => {
    try {
      return local().getItem(key)
    } catch {
      return null
    }
  }
  const clearStatus = () =>
    quietly(() => {
      local().removeItem(KEYS.lastSyncAt)
      local().removeItem(KEYS.problem)
    })

  // A readers-writer gate: syncs run side by side, and a change of account runs alone.
  let running = 0
  let idle: Array<() => void> = []
  let changing: Promise<void> | null = null

  const settle = () => {
    if (running > 0) return
    const waiting = idle
    idle = []
    for (const resolve of waiting) resolve()
  }

  const alone = async (task: () => Promise<void>) => {
    while (changing) await changing.catch(() => undefined)
    const change = (async () => {
      if (running > 0) await new Promise<void>((resolve) => idle.push(resolve))
      await task()
    })()
    changing = change
    try {
      await change
    } finally {
      changing = null
    }
  }

  const current = () => parseAccount(read(KEYS.account))

  return {
    current,
    async use(task) {
      while (changing) await changing.catch(() => undefined)
      const account = current()
      if (!account) return null
      running += 1
      try {
        return await task(account)
      } finally {
        running -= 1
        settle()
      }
    },
    // The sync state resets before the account is saved, under the push lock, so no chunk is on its way to the account
    // before while the account changes, and a switch that stops half way leaves a first sync to run with the account
    // before, which only merges again, never a device that skips the first sync with the new one.
    switchTo: (account) =>
      alone(() =>
        lock(async () => {
          await restartFirstSync(storage)
          local().setItem(KEYS.account, JSON.stringify(account))
          quietly(() => local().removeItem(KEYS.signedOut))
          clearStatus()
        })
      ),
    signOut: () =>
      alone(async () => {
        local().removeItem(KEYS.account)
        quietly(() => local().setItem(KEYS.signedOut, '1'))
        clearStatus()
      }),
    signedOut: () => read(KEYS.signedOut) === '1',
    status: () => ({
      lastSyncAt: read(KEYS.lastSyncAt),
      problem: read(KEYS.problem) === 'row_limit' ? 'row_limit' : null
    }),
    synced: (at) =>
      quietly(() => {
        local().setItem(KEYS.lastSyncAt, at)
        local().removeItem(KEYS.problem)
      }),
    // A full account refuses every push from now on, so the pages say so instead of failing quietly.
    failed: (error) => {
      if (error instanceof ServerError && error.code === 'row_limit') {
        quietly(() => local().setItem(KEYS.problem, 'row_limit'))
      }
    }
  }
}

// The app's account, kept in this origin's localStorage.
export const account = createAccounts({ storage: appStorage, lock: pushLock, local: () => localStorage })
