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
        gymtime: 'gymtime/index.html'
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
  staged: {
    '*': 'vp check --fix'
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
