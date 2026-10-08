import { createHash } from 'node:crypto'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite-plus'
import { partials } from './partials/plugin.ts'

// Files from public/ that the pages load. The manifest icons and screenshots are only fetched when installing.
const PUBLIC_PRECACHE = ['/app.webmanifest', '/icons/favicon.ico', '/icons/apple-touch-icon.png']

// Hands the built service worker every file of the build, so it can cache them all on install, and a hash of their
// contents, so each deploy gets a new sw.js and the browser installs it.
const serviceWorker = (): Plugin => ({
  name: 'jimbro:service-worker',
  apply: 'build',
  enforce: 'post',
  generateBundle(_, bundle) {
    const worker = bundle['sw.js']
    if (worker?.type !== 'chunk') return this.error('The build has no sw.js chunk')

    const files = Object.values(bundle).filter((file) => file.fileName !== 'sw.js' && !file.fileName.endsWith('.map'))
    const hash = createHash('sha256')
    for (const file of files) hash.update(file.fileName).update(file.type === 'chunk' ? file.code : file.source)
    // A page is cached under the URL the app links to: '/gymtime/', not '/gymtime/index.html'.
    const urls = files.map((file) => `/${file.fileName}`.replace(/index\.html$/, ''))

    worker.code = worker.code
      .replace('__PRECACHE_URLS__', JSON.stringify([...urls, ...PUBLIC_PRECACHE]))
      .replace('__PRECACHE_VERSION__', JSON.stringify(hash.digest('hex').slice(0, 16)))
  }
})

export default defineConfig({
  plugins: [partials(), tailwindcss(), serviceWorker()],
  build: {
    rolldownOptions: {
      input: {
        home: 'index.html',
        exercises: 'exercises/index.html',
        programs: 'programs/index.html',
        settings: 'settings/index.html',
        workouts: 'workouts/index.html',
        gymtime: 'gymtime/index.html',
        stats: 'stats/index.html',
        sw: 'src/serviceWorker.ts'
      },
      output: {
        // The service worker's URL is its scope and must stay the same across builds.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js')
      }
    }
  },
  fmt: {
    singleQuote: true,
    semi: false,
    trailingComma: 'none',
    printWidth: 120,
    useTabs: false
  },
  lint: {
    // oxlint's default plugins, plus import for no-cycle.
    plugins: ['typescript', 'unicorn', 'oxc', 'import'],
    // Gives rules such as no-floating-promises the types. Type errors stay with the typecheck scripts.
    options: { typeAware: true },
    rules: {
      // A module that reads an import while the cycle is still loading it gets undefined or a TDZ error, and a
      // storage.ts and utils.ts cycle once broke the build (1716b9a).
      'import/no-cycle': 'error',
      // The next line ran before an unawaited call finished, until 21bd233, e7795a0 and 1b00437 added the await.
      'typescript/no-floating-promises': 'error'
    },
    overrides: [
      {
        // Pages own the dialogs. The data layers throw, and the page decides what to tell the user.
        files: ['src/db/**', 'src/sync/**'],
        rules: { 'no-alert': 'error' }
      },
      {
        // Upgrading an old export turns whatever a field holds into text on purpose.
        files: ['src/db/schemaUpgrade.ts'],
        rules: { 'typescript/no-base-to-string': 'off' }
      },
      {
        // Tests pass methods to vi.mocked and expect as values, which never call them without their object.
        files: ['tests/**'],
        rules: { 'typescript/unbound-method': 'off' }
      }
    ]
  },
  staged: {
    '*': 'vp check --fix'
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
