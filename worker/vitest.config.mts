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
            // A key pair made for the tests by scripts/vapid-keys.mjs, used nowhere else.
            VAPID_PUBLIC_KEY: 'BBicmIbnj-sUud1yyryaCwebjCivs6B3iSfrUR0UzBuwQwKdOhG2bgnLT9jDWFElNSVyyiwiHxywQsGM8VHRMNY',
            VAPID_PRIVATE_KEY: 'mhdoxbp3NylHls-aUeOLKum1EN6EB5pE1sDH-pWM6TE',
            VAPID_SUBJECT: 'mailto:test@example.com',
            TEST_MIGRATIONS: migrations
          }
        }
      }
    }
  }
})
