import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this project from /<repo>/, so the base has to match.
// Override with BASE_PATH=/ for a root-hosted deploy.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/globle/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
});
