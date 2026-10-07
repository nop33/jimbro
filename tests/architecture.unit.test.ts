import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const root = path.resolve(import.meta.dirname, '..')

const sourceFiles = (dir: string): Array<string> =>
  readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => path.join(dir, file))

const appAndWorkerFiles = [...sourceFiles('src'), ...sourceFiles('worker/src')]

describe('architecture', () => {
  it('imports every symbol from the module that declares it', () => {
    const reExport = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
    const found = appAndWorkerFiles.flatMap((file) =>
      [...readFileSync(path.join(root, file), 'utf8').matchAll(reExport)].map(
        ([, from]) =>
          `${file} re-exports from '${from}'. Import from '${from}' where it is used and delete the re-export.`
      )
    )
    expect(found).toEqual([])
  })

  it('leaves the outbox and meta stores to src/sync', () => {
    // The schema creates them. Everything else reaches them through src/sync, so the rules for an entry's seq and
    // inflight stamp live next to the push and pull that depend on them.
    const schema = ['src/db/constants.ts', 'src/db/migrations.ts'].map((file) => path.normalize(file))
    const syncStore = /OBJECT_STORES\.(?:OUTBOX|META)\b|['"](?:outbox|meta)['"]/
    const found = sourceFiles('src')
      .filter((file) => !file.startsWith(path.join('src', 'sync')) && !schema.includes(file))
      .filter((file) => syncStore.test(readFileSync(path.join(root, file), 'utf8')))
      .map(
        (file) =>
          `${file} reads or writes the outbox or meta store. Use storage.writeRows to queue a row, and the src/sync modules for the rest.`
      )
    expect(found).toEqual([])
  })

  it('leaves page notices to pageChannel and custom events to EventEmitter', () => {
    // A jimbro: window event reaches only its own tab. Settings and gymtime each heard only those and missed the
    // other tabs' writes and syncs, until 3e600d6 and 5317946. A custom event between modules, like the
    // exercise-clicked event that ExerciseList's callback replaced, reaches its listeners untyped.
    const channelFile = path.normalize('src/sync/pageChannel.ts')
    const emitterFile = path.normalize('src/eventEmitter.ts')
    const windowNotice = /(?:EventListener|Event)\s*(?:<.*?>)?\(\s*['"`]jimbro:/
    const customEvent = /new\s+CustomEvent\s*(?:<.*?>)?\((?!\s*['"`]jimbro:)/
    const files = sourceFiles('src').filter((file) => file !== channelFile)
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
    const found = [
      ...files
        .filter((file) => windowNotice.test(read(file)))
        .map(
          (file) =>
            `${file} sends or hears a jimbro: window event, which reaches only this tab. Use announce and onPageNotice from src/sync/pageChannel.ts, which reach every tab.`
        ),
      ...files
        .filter((file) => file !== emitterFile && customEvent.test(read(file)))
        .map(
          (file) =>
            `${file} creates a CustomEvent, which its listeners must cast to read. Give the other module a typed callback, or use EventEmitter from src/eventEmitter.ts.`
        )
    ]
    expect(found).toEqual([])
  })

  it('opens a readwrite transaction only in writeRows and src/sync', () => {
    // A row put in any other transaction never reaches the outbox, so it never syncs. The Storage writers that
    // 51fa002 deleted did that.
    const writeRowsFile = path.normalize('src/db/storage.ts')
    const found = sourceFiles('src')
      .filter((file) => !file.startsWith(path.join('src', 'sync')))
      .flatMap((file) => {
        const opened = readFileSync(path.join(root, file), 'utf8').match(/['"]readwrite['"]/g)?.length ?? 0
        const allowed = file === writeRowsFile ? 1 : 0
        return opened > allowed
          ? [
              `${file} opens ${opened} readwrite transactions where ${allowed} is allowed. Write rows with storage.writeRows, and keep the sync's own transactions in src/sync.`
            ]
          : []
      })
    expect(found).toEqual([])
  })

  it('takes calendar dates from local time, never from toISOString', () => {
    // toISOString() is UTC, so away from UTC its date is a day off for part of every day. f9d3364 fixed the
    // workout form's default date for that.
    const utcDay =
      /toISOString\(\)\s*\.\s*(?:split\(\s*['"]T['"]|slice\(\s*0\s*,\s*10\s*\)|substr(?:ing)?\(\s*0\s*,\s*10\s*\))/
    const found = sourceFiles('src')
      .filter((file) => utcDay.test(readFileSync(path.join(root, file), 'utf8')))
      .map(
        (file) =>
          `${file} takes a date from toISOString(), which is UTC. Use getSimpleDate from src/dateUtils.ts for today, and parseSimpleDate to read a stored date.`
      )
    expect(found).toEqual([])
  })
})
