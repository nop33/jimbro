interface TestMigration {
  name: string
  queries: string[]
}

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: TestMigration[]
  }
}
