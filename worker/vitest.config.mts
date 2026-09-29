import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

const migrations = await readD1Migrations(path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'))

export default defineWorkersConfig({
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            AUTH_TOKENS: '{"test-token-123":"nikos"}',
            DEV_ORIGIN: 'http://localhost:5199',
            TEST_MIGRATIONS: migrations
          }
        }
      }
    }
  }
})
