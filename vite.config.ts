import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        workouts: resolve(__dirname, "workouts/index.html"),
        settings: resolve(__dirname, "settings/index.html"),
      },
    },
  },
});
