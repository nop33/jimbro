// `wrangler dev` puts a proxy of its own in front of the worker, which answers 503 to any POST or OPTIONS whose hop to
// the worker fails, whatever the cause, and holds such a GET until a reload that never comes. Here the browser talks to
// workerd directly.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const [bundle, port, persistTo, envFile] = process.argv.slice(2)
if (!bundle || !port || !persistTo || !envFile) {
  throw new Error('Usage: node scripts/serve-local.mjs <bundle.js> <port> <persist-dir> <env-file>')
}

const workerDir = path.join(import.meta.dirname, '..')
const require = createRequire(path.join(workerDir, 'package.json'))
const wrangler = require('wrangler')
const requireFromWrangler = createRequire(require.resolve('wrangler'))
const { Miniflare, Log, LogLevel } = requireFromWrangler('miniflare')

const { workerOptions } = wrangler.unstable_getMiniflareWorkerOptions(
  path.join(workerDir, 'wrangler.jsonc'),
  undefined,
  {
    envFiles: [envFile]
  }
)

const miniflare = new Miniflare({
  ...workerOptions,
  modules: [{ type: 'ESModule', path: 'index.js', contents: readFileSync(bundle, 'utf8') }],
  host: '127.0.0.1',
  port: Number(port),
  // Where `wrangler d1 migrations apply --local --persist-to` put the schema.
  d1Persist: path.join(persistTo, 'v3', 'd1'),
  durableObjectsPersist: path.join(persistTo, 'v3', 'do'),
  log: new Log(LogLevel.WARN)
})

await miniflare.ready
const stop = () => void miniflare.dispose().finally(() => process.exit(0))
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
