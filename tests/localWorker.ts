import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { FullConfig } from '@playwright/test'

const execFileAsync = promisify(execFile)

// Not 8787 or 8788, where `wrangler dev` and `wrangler pages dev` listen by default.
const port = Number(process.env.WORKER_PORT ?? 8790)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`WORKER_PORT must be a port number, got "${process.env.WORKER_PORT}".`)
}

// Global setup starts a fresh `wrangler dev` on this port for every run, and
// playwright.config.ts points the dev server's VITE_API_BASE at it.
export const WORKER_PORT = port
export const API_BASE = `http://127.0.0.1:${WORKER_PORT}`

const WORKER_DIR = path.join(import.meta.dirname, '..', 'worker')
// The worker's own wrangler, run with this Node the way `vp exec wrangler` would, minus vp's banner.
const WRANGLER = path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
// Every wrangler call gets the run's --env-file, which keeps .dev.vars and .env out.
// These keep the developer's shell out too, and send no telemetry from test runs.
const WRANGLER_ENV = {
  ...process.env,
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true',
  CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  WRANGLER_SEND_METRICS: 'false'
}
// Global setup hands these to the test workers through the environment.
const RUN_DIR = 'JIMBRO_WORKER_RUN_DIR'
const START_ERROR = 'JIMBRO_WORKER_START_ERROR'
// Each test attempt claims one or two users. This covers every project with retries
// and several --repeat-each rounds.
const USER_POOL = 1000

export interface WorkerUser {
  token: string
  userId: string
}

const userAt = (index: number): WorkerUser => ({ token: `token-${index}`, userId: `user-${index}` })

const runDir = () => {
  const failure = process.env[START_ERROR]
  if (failure) throw new Error(failure)
  const dir = process.env[RUN_DIR]
  if (!dir) throw new Error('The local worker is not running. The global setup in playwright.config.ts starts it.')
  return dir
}

let nextUser = 0

// Returns a user no other test of this run has touched, so tests stay independent
// of each other across workers, projects, retries and --repeat-each.
export const claimUser = (): WorkerUser => {
  const dir = runDir()
  while (nextUser < USER_POOL) {
    const index = nextUser++
    try {
      // Only one process can create the directory, so no two tests share a user.
      mkdirSync(path.join(dir, 'users', String(index)))
      return userAt(index)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  throw new Error(`All ${USER_POOL} worker users are taken. Start a new run for fresh ones.`)
}

const stateDir = (dir: string) => path.join(dir, 'state')
const envFile = (dir: string) => path.join(dir, 'worker.env')

const runWrangler = async (dir: string, args: string[]) => {
  try {
    await execFileAsync(process.execPath, [WRANGLER, ...args, '--env-file', envFile(dir)], {
      cwd: WORKER_DIR,
      env: WRANGLER_ENV
    })
  } catch (error) {
    // execFile rejects with an error that carries what the command printed.
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string }
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed.\n${stdout}${stderr}`, { cause: error })
  }
}

const assertPortFree = () =>
  new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      if (!('code' in error) || error.code !== 'EADDRINUSE') return reject(error)
      reject(
        new Error(
          `port ${WORKER_PORT} is already in use. Stop what listens there, or give the tests another port with WORKER_PORT.`
        )
      )
    })
    server.listen(WORKER_PORT, '127.0.0.1', () => server.close(() => resolve()))
  })

const workerVars = (probe: WorkerUser, pageOrigin: string | undefined) => {
  const users = [probe, ...Array.from({ length: USER_POOL }, (_, index) => userAt(index))]
  const tokens = Object.fromEntries(users.map((user) => [user.token, user.userId]))
  const lines = [`AUTH_TOKENS='${JSON.stringify(tokens)}'`]
  // The dev server may run on any port, so the worker has to accept its origin.
  if (pageOrigin) lines.push(`DEV_ORIGIN=${pageOrigin}`)
  return `${lines.join('\n')}\n`
}

// A negative pid signals the whole process group: wrangler, workerd and their helpers.
const signalGroup = (pid: number, signal: string | number) => {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

const stop = async (worker: ChildProcess) => {
  const pid = worker.pid
  if (pid === undefined) return
  signalGroup(pid, 'SIGTERM')
  const deadline = Date.now() + 5_000
  while (signalGroup(pid, 0) && Date.now() < deadline) await sleep(100)
  signalGroup(pid, 'SIGKILL')
}

// A new connection for every ping. fetch would keep reusing its first connection, and
// that one may belong to another server on the port even after wrangler binds 127.0.0.1.
const pingAs = (token: string) =>
  new Promise<unknown>((resolve) => {
    const options = { agent: false, headers: { Authorization: `Bearer ${token}` }, timeout: 2_000 }
    const request = get(`${API_BASE}/api/ping`, options, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
      })
      response.on('error', () => resolve(undefined))
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(undefined)
        try {
          resolve((JSON.parse(body) as { userId?: unknown }).userId)
        } catch {
          resolve(undefined)
        }
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(undefined))
  })

const waitUntilReady = async (worker: ChildProcess, probe: WorkerUser) => {
  let ended: string | undefined
  worker.once('error', (error) => {
    ended = `failed: ${error.message}`
  })
  worker.once('exit', (code, signal) => {
    ended = `exited with ${code ?? signal}`
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (ended) throw new Error(`wrangler dev ${ended} before it answered. Its output is above.`)
    // Only this run's worker knows the probe token, so a match means the answer came from
    // it. On macOS the port check misses a server listening on all addresses, and until
    // wrangler binds 127.0.0.1 that server gets the requests.
    if ((await pingAs(probe.token)) === probe.userId) return
    await sleep(200)
  }
  throw new Error(`wrangler dev did not answer on port ${WORKER_PORT} within a minute.`)
}

const launch = async (dir: string, pageOrigin: string | undefined) => {
  if (!existsSync(WRANGLER)) throw new Error('the worker dependencies are missing. Run `cd worker && vp install`.')
  await assertPortFree()
  const probe = { token: randomUUID(), userId: 'probe' }
  writeFileSync(envFile(dir), workerVars(probe, pageOrigin))
  await runWrangler(dir, ['d1', 'migrations', 'apply', 'jimbro', '--local', '--persist-to', stateDir(dir)])
  const worker = spawn(
    process.execPath,
    [
      WRANGLER,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(WORKER_PORT),
      '--inspector-port',
      '0',
      '--persist-to',
      stateDir(dir),
      '--env-file',
      envFile(dir),
      '--log-level',
      'warn'
    ],
    // Its own process group, so stopping it also stops the workerd it spawns.
    { cwd: WORKER_DIR, detached: true, stdio: ['ignore', 'inherit', 'inherit'], env: WRANGLER_ENV }
  )
  try {
    await waitUntilReady(worker, probe)
  } catch (error) {
    await stop(worker)
    throw error
  }
  return worker
}

// Global setup: one worker for the whole run, with fresh local D1 state in a
// temporary directory, so a rerun behaves like a first run. Tests reach it through
// claimUser and API_BASE. If it cannot start, only the tests that claim a user fail.
export default async function startLocalWorker(config: FullConfig) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jimbro-worker-'))
  mkdirSync(path.join(dir, 'users'))
  process.env[RUN_DIR] = dir
  const baseURL = config.projects[0]?.use.baseURL
  let worker: ChildProcess | undefined
  try {
    worker = await launch(dir, baseURL ? new URL(baseURL).origin : undefined)
  } catch (error) {
    process.env[START_ERROR] =
      `The local worker did not start: ${error instanceof Error ? error.message : String(error)}`
  }
  const pid = worker?.pid
  // Teardown is the normal way out. This covers a runner that exits without it.
  const onExit = () => {
    if (pid !== undefined) signalGroup(pid, 'SIGTERM')
  }
  process.once('exit', onExit)
  return async () => {
    if (worker) await stop(worker)
    process.off('exit', onExit)
    rmSync(dir, { recursive: true, force: true })
  }
}
