interface TestMigration {
  name: string
  queries: string[]
}

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: TestMigration[]
    VAPID_PUBLIC_KEY?: string
    VAPID_PRIVATE_KEY?: string
    VAPID_SUBJECT?: string
  }
}
