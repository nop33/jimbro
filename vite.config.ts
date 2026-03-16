import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    singleQuote: true,
    semi: false,
    trailingComma: 'none',
    printWidth: 120
  },
  staged: {
    '*': 'vp check --fix'
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
