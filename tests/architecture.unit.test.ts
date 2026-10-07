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
})
