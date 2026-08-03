import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Project site on GitHub Pages -> assets served under /Candidate-Issue-Tracker/
export default defineConfig({
  root: 'site',
  base: '/Candidate-Issue-Tracker/',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
