import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        home: 'index.html',
        exercises: 'exercises/index.html',
        programs: 'programs/index.html',
        settings: 'settings/index.html',
        workouts: 'workouts/index.html',
        gymtime: 'gymtime/index.html',
        stats: 'stats/index.html'
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
    rules: {
      // A module that reads an import while the cycle is still loading it gets undefined or a TDZ error, and a
      // storage.ts and utils.ts cycle once broke the build (1716b9a).
      'import/no-cycle': 'error'
    },
    overrides: [
      {
        // Pages own the dialogs. The data layers throw, and the page decides what to tell the user.
        files: ['src/db/**', 'src/sync/**'],
        rules: { 'no-alert': 'error' }
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
