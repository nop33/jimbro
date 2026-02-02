import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import injectHTML from 'vite-plugin-html-inject'

export default defineConfig({
  plugins: [injectHTML(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        exercises: resolve(__dirname, 'exercises/index.html'),
        programs: resolve(__dirname, 'programs/index.html'),
        settings: resolve(__dirname, 'settings/index.html'),
        workouts: resolve(__dirname, 'workouts/index.html'),
        gymtime: resolve(__dirname, 'gymtime/index.html')
      }
    }
  }
})
