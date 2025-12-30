import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        exercises: resolve(__dirname, 'exercises/index.html'),
        programs: resolve(__dirname, 'programs/index.html'),
        settings: resolve(__dirname, 'settings/index.html')
      }
    }
  }
})
